import assert from "node:assert/strict";
import test from "node:test";
import { createGear, loadLatestGear, patchGear, type FetchLike } from "./gearEditorRequests";
import { errorBody, gearItem, jsonResponse, savedRow, textResponse } from "./gearEditorTestKit";

type Call = { url: string; init: RequestInit | undefined };
function scripted(...answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const queue = [...answers];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}
const PAYLOAD = { name: "Trail Tee", tags: [] };

test("patchGear sends PATCH to the item URL with the token as expectedVersion in the body, after the editable fields", async () => {
  const { fetchImpl, calls } = scripted(jsonResponse(savedRow()));
  const outcome = await patchGear(fetchImpl, "g1", 3, PAYLOAD);
  assert.equal(calls[0].url, "/api/admin/gear/g1");
  assert.equal(calls[0].init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { name: "Trail Tee", tags: [], expectedVersion: 3 });
  assert.equal(outcome.kind, "saved");
  assert.equal(outcome.kind === "saved" && outcome.item.version, 4);
});

test("patchGear never sends a request without a usable token, and never invents one", async () => {
  for (const version of [undefined, null, "3", -1, 1.5, 2_147_483_648, Number.NaN]) {
    const { fetchImpl, calls } = scripted();
    assert.deepEqual(await patchGear(fetchImpl, "g1", version, PAYLOAD), { kind: "badVersion" }, String(version));
    assert.equal(calls.length, 0);
  }
  const { fetchImpl, calls } = scripted();
  assert.deepEqual(await patchGear(fetchImpl, "", 3, PAYLOAD), { kind: "badVersion" });
  assert.equal(calls.length, 0);
});

test("patchGear classifies by status AND code: STALE_VERSION and CONFLICT are different 409s", async () => {
  const cases: Array<[Response | Error, string]> = [
    [jsonResponse(errorBody("STALE_VERSION"), 409), "stale"],
    [jsonResponse(errorBody("CONFLICT"), 409), "conflict"],
    [jsonResponse({ error: "?" }, 409), "rejected"],
    [textResponse("not json", 409), "rejected"],
    [jsonResponse(errorBody("NOT_FOUND"), 404), "notFound"],
    [jsonResponse({ error: "Invalid request payload", issues: [] }, 400), "invalid"],
    [jsonResponse(errorBody("UNAUTHORIZED"), 401), "unauthorized"],
    [jsonResponse(errorBody("FORBIDDEN"), 403), "unauthorized"],
    [jsonResponse({ error: "Admin request failed" }, 500), "unknown"],
    [jsonResponse({}, 503), "unknown"],
    [jsonResponse({}, 429), "rejected"],
    [new TypeError("Failed to fetch"), "unknown"],
  ];
  for (const [answer, kind] of cases) assert.equal((await patchGear(scripted(answer).fetchImpl, "g1", 3, PAYLOAD)).kind, kind, `${answer instanceof Error ? "network error" : answer.status}`);
  assert.deepEqual(await patchGear(scripted(jsonResponse(errorBody("UNAUTHORIZED"), 401)).fetchImpl, "g1", 3, PAYLOAD), { kind: "unauthorized", status: 401 });
  assert.deepEqual(await patchGear(scripted(jsonResponse(errorBody("FORBIDDEN"), 403)).fetchImpl, "g1", 3, PAYLOAD), { kind: "unauthorized", status: 403 });
  assert.deepEqual(await patchGear(scripted(new TypeError("x")).fetchImpl, "g1", 3, PAYLOAD), { kind: "unknown", reason: "network" });
});

test("a 2xx whose body can not be trusted is an UNKNOWN outcome, never a success: wrong id, missing or malformed version, unreadable body", async () => {
  for (const body of [savedRow({ id: "other" }), savedRow({ version: undefined }), savedRow({ version: "4" }), savedRow({ version: -1 }), savedRow({ version: 1.5 }), null, [], "x"]) {
    assert.deepEqual(await patchGear(scripted(jsonResponse(body)).fetchImpl, "g1", 3, PAYLOAD), { kind: "unknown", reason: "malformed" }, JSON.stringify(body));
  }
  assert.deepEqual(await patchGear(scripted(textResponse("<html>")).fetchImpl, "g1", 3, PAYLOAD), { kind: "unknown", reason: "malformed" });
});

test("createGear keeps the existing POST contract: no expectedVersion, and a created item must carry an id", async () => {
  const { fetchImpl, calls } = scripted(jsonResponse({ id: "new", name: "X" }, 201));
  const outcome = await createGear(fetchImpl, PAYLOAD);
  assert.equal(calls[0].url, "/api/admin/gear");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), PAYLOAD);
  assert.deepEqual(outcome, { kind: "created", item: { id: "new", name: "X" } });
  assert.equal((await createGear(scripted(jsonResponse({}, 201)).fetchImpl, PAYLOAD)).kind, "unknown", "an unreadable create is unconfirmed");
  assert.equal((await createGear(scripted(jsonResponse({}, 400)).fetchImpl, PAYLOAD)).kind, "failed");
  assert.equal((await createGear(scripted(jsonResponse({}, 409)).fetchImpl, PAYLOAD)).kind, "failed");
  assert.equal((await createGear(scripted(jsonResponse({}, 500)).fetchImpl, PAYLOAD)).kind, "unknown");
  assert.equal((await createGear(scripted(new TypeError("x")).fetchImpl, PAYLOAD)).kind, "unknown");
  assert.deepEqual(await createGear(scripted(jsonResponse({}, 403)).fetchImpl, PAYLOAD), { kind: "unauthorized", status: 403 });
});

test("loadLatestGear reads the existing authenticated list, uncached, and picks the item by exact id", async () => {
  const list = [gearItem({ id: "g0", name: "First" }), gearItem({ id: "g1", name: "Wanted", version: 8 }), gearItem({ id: "g2", name: "Third" })];
  const { fetchImpl, calls } = scripted(jsonResponse(list));
  const outcome = await loadLatestGear(fetchImpl, "g1");
  assert.equal(calls[0].url, "/api/admin/gear");
  assert.equal(calls[0].init?.method, "GET");
  assert.equal(calls[0].init?.cache, "no-store", "never served from a client cache");
  assert.equal(outcome.kind === "loaded" && outcome.item.name, "Wanted");
  assert.equal(outcome.kind === "loaded" && outcome.item.version, 8);
});

test("loadLatestGear never substitutes another item: a missing id is notFound, an unusable item is malformed", async () => {
  assert.deepEqual(await loadLatestGear(scripted(jsonResponse([gearItem({ id: "g0" }), gearItem({ id: "g2" })])).fetchImpl, "g1"), { kind: "notFound" }, "the first item is NOT substituted");
  assert.deepEqual(await loadLatestGear(scripted(jsonResponse([])).fetchImpl, "g1"), { kind: "notFound" });
  for (const bad of [{ ...gearItem(), version: undefined }, { ...gearItem(), version: "3" }, { ...gearItem(), category: "SHOES" }]) {
    assert.deepEqual(await loadLatestGear(scripted(jsonResponse([bad])).fetchImpl, "g1"), { kind: "malformed" });
  }
  for (const body of [{}, null, "x", { items: [] }]) assert.deepEqual(await loadLatestGear(scripted(jsonResponse(body)).fetchImpl, "g1"), { kind: "malformed" });
  assert.deepEqual(await loadLatestGear(scripted(textResponse("<html>")).fetchImpl, "g1"), { kind: "malformed" });
});

test("loadLatestGear failures are classified, never thrown", async () => {
  assert.deepEqual(await loadLatestGear(scripted(jsonResponse({}, 401)).fetchImpl, "g1"), { kind: "unauthorized", status: 401 });
  assert.deepEqual(await loadLatestGear(scripted(jsonResponse({}, 403)).fetchImpl, "g1"), { kind: "unauthorized", status: 403 });
  assert.deepEqual(await loadLatestGear(scripted(jsonResponse({}, 500)).fetchImpl, "g1"), { kind: "failed" });
  assert.deepEqual(await loadLatestGear(scripted(new TypeError("offline")).fetchImpl, "g1"), { kind: "failed" });
});
