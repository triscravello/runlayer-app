import assert from "node:assert/strict";
import test from "node:test";
import { DISCARD_MESSAGE } from "./gearEditorController";
import { buildGearPayload, mergeSavedGearItem } from "./gearEditorModel";
import { canSave, isDirty, MESSAGES } from "./gearEditorState";
import { createHarness, deferred, errorBody, gearItem, jsonResponse, savedRow } from "./gearEditorTestKit";

const stale = () => jsonResponse(errorBody("STALE_VERSION"), 409);

test("initial version capture and PATCH forwarding: the first save sends the item's version as expectedVersion, in the body, never as a field", async () => {
  const h = createHarness({ responses: [jsonResponse(savedRow({ version: 4 }))] });
  h.edit("name", "Renamed");
  await h.controller.save();
  assert.equal(h.requests.length, 1);
  assert.deepEqual([h.requests[0].method, h.requests[0].url], ["PATCH", "/api/admin/gear/g1"]);
  assert.deepEqual(h.requests[0].body, { ...buildGearPayload({ ...h.state.draft }), expectedVersion: 3 });
  assert.equal("version" in (h.requests[0].body ?? {}), false);
});

test("successful save: the version advances, the parent is told with the matching id, and two successive saves use 3 then 4", async () => {
  const h = createHarness({ responses: [jsonResponse(savedRow({ version: 4 })), jsonResponse(savedRow({ version: 5, updatedAt: "2026-03-01T00:00:00.000Z" }))] });
  h.edit("name", "First");
  await h.controller.save();
  assert.deepEqual([h.state.status, h.state.version, isDirty(h.state)], ["saved", 4, false]);
  assert.deepEqual(h.events.saved.map((event) => [event.id, event.saved.version]), [["g1", 4]]);
  h.edit("name", "Second");
  await h.controller.save();
  assert.deepEqual(h.requests.map((request) => request.body?.expectedVersion), [3, 4], "the second save is conditioned on the version the first one returned");
  assert.deepEqual([h.state.version, h.state.updatedAt], [5, "2026-03-01T00:00:00.000Z"]);
});

test("missing or malformed versions: no request is ever sent", async () => {
  for (const version of [undefined, null, "3" as unknown as number, -1, 1.5, 2_147_483_648]) {
    const h = createHarness({ item: gearItem({ version }) });
    await h.controller.save();
    assert.equal(h.requests.length, 0, String(version));
    assert.equal(canSave(h.state), false);
    assert.equal(h.state.versionProblem, true);
  }
});

test("existing field validation is unchanged and runs before any request", async () => {
  const h = createHarness();
  h.edit("affiliateUrl", "javascript:alert(1)");
  await h.controller.save();
  assert.equal(h.requests.length, 0);
  assert.deepEqual([h.state.status, h.state.message], ["error", "Affiliate URL must be blank or a valid http or https URL."]);
  h.edit("affiliateUrl", "https://ok.example.com");
  h.edit("name", "  ");
  await h.controller.save();
  assert.equal(h.state.message, "Name, brand ID, category, and price range are required.");
  assert.equal(h.requests.length, 0);
});

test("stale conflict: the draft and the old token are kept, Save is disabled, nothing retries, and Keep editing does not enable Save", async () => {
  const h = createHarness({ responses: [stale()] });
  h.edit("name", "Mine");
  h.edit("subcategory", "also mine");
  await h.controller.save();
  assert.equal(h.state.status, "stale");
  assert.deepEqual([h.state.draft.name, h.state.draft.subcategory, h.state.version], ["Mine", "also mine", 3]);
  assert.equal(canSave(h.state), false);
  await h.controller.save();
  await h.controller.save();
  assert.equal(h.requests.length, 1, "no automatic retry, and Save does nothing while stale");
  h.dispatch({ type: "keepEditing" });
  await h.controller.save();
  assert.deepEqual([h.state.status, h.state.conflictAcknowledged, canSave(h.state), h.requests.length], ["stale", true, false, 1]);
});

test("STALE_VERSION and a uniqueness CONFLICT are classified differently", async () => {
  const staleRun = createHarness({ responses: [stale()] });
  await staleRun.controller.save();
  const conflictRun = createHarness({ responses: [jsonResponse(errorBody("CONFLICT"), 409)] });
  await conflictRun.controller.save();
  assert.deepEqual([staleRun.state.status, canSave(staleRun.state)], ["stale", false]);
  assert.deepEqual([conflictRun.state.status, conflictRun.state.message, canSave(conflictRun.state), conflictRun.state.version], ["error", MESSAGES.nameConflict, true, 3], "a name conflict keeps the token and lets the user correct and save again");
});

test("load latest needs explicit confirmation before discarding edits; declining changes nothing and sends nothing", async () => {
  const h = createHarness({ responses: [stale()], confirmAnswer: false });
  h.edit("name", "Mine");
  await h.controller.save();
  const before = h.state;
  await h.controller.loadLatest("reload");
  assert.deepEqual(h.events.confirms, [DISCARD_MESSAGE]);
  assert.equal(h.requests.length, 1, "no reload request was made");
  assert.equal(h.state, before, "the state object is untouched");
  assert.equal(h.state.draft.name, "Mine");
});

test("confirmed load latest: GET the list, replace draft, baseline and token with the server item, and tell the parent", async () => {
  const latest = [gearItem({ id: "g0" }), gearItem({ name: "Server name", version: 7, updatedAt: "2026-05-01T00:00:00.000Z" })];
  const h = createHarness({ responses: [stale(), jsonResponse(latest)], confirmAnswer: true });
  h.edit("name", "Mine");
  await h.controller.save();
  await h.controller.loadLatest("reload");
  assert.deepEqual([h.requests[1].method, h.requests[1].url, h.requests[1].cache], ["GET", "/api/admin/gear", "no-store"]);
  assert.deepEqual([h.state.status, h.state.draft.name, h.state.version, isDirty(h.state), canSave(h.state)], ["idle", "Server name", 7, false, true]);
  assert.deepEqual(h.events.reloaded.map((event) => [event.id, event.item.version]), [["g1", 7]]);
  // The next save uses the reloaded version.
  h.queue.push(jsonResponse(savedRow({ version: 8 })));
  h.edit("name", "After reload");
  await h.controller.save();
  assert.equal(h.requests[2].body?.expectedVersion, 7);
});

test("a clean stale baseline reloads without asking: there is nothing to discard", async () => {
  const h = createHarness({ responses: [stale(), jsonResponse([gearItem({ version: 6 })])], confirmAnswer: false });
  await h.controller.save();
  await h.controller.loadLatest("reload");
  assert.deepEqual(h.events.confirms, []);
  assert.equal(h.state.version, 6);
});

test("failed, missing, malformed and unauthorized reloads preserve the draft and keep the old token", async () => {
  const cases = [
    jsonResponse({}, 500), new TypeError("offline"), jsonResponse([gearItem({ id: "g0" })]), jsonResponse([{ ...gearItem(), version: undefined }]), jsonResponse({}, 401), jsonResponse({}, 403),
  ];
  for (const failure of cases) {
    const h = createHarness({ responses: [stale(), failure] });
    h.edit("name", "Mine");
    await h.controller.save();
    await h.controller.loadLatest("reload");
    assert.equal(h.state.draft.name, "Mine");
    assert.equal(h.state.version, 3);
    assert.equal(h.events.reloaded.length, 0);
    assert.notEqual(h.state.status, "reloading", "never stuck");
    assert.equal(canSave(h.state), false);
  }
});

test("double-save prevention: rapid clicks before the UI has re-rendered send exactly one request (the guard is synchronous, not React state)", async () => {
  const gate = deferred<Response>();
  const h = createHarness({ responses: [() => gate.promise], lagged: true });
  h.edit("name", "Once");
  const first = h.controller.save();
  const second = h.controller.save();
  const third = h.controller.retrySame();
  assert.equal(h.requests.length, 1, "exactly one request in flight");
  gate.resolve(jsonResponse(savedRow({ version: 4 })));
  await Promise.all([first, second, third]);
  h.flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.version, 4);
  h.queue.push(jsonResponse(savedRow({ version: 5 })));
  h.edit("name", "Twice");
  h.flush();
  await h.controller.save();
  assert.equal(h.requests.length, 2, "once the first save is done, saving works again");
});

test("item-switch race: a late save response updates the item it was for, never another editor", async () => {
  const gate = deferred<Response>();
  const a = createHarness({ item: gearItem({ id: "gA", version: 1 }), responses: [() => gate.promise] });
  const b = createHarness({ item: gearItem({ id: "gB", name: "Other", version: 10 }) });
  a.edit("name", "A edited");
  const pending = a.controller.save();                        // the user then switches to item B (a different editor instance)
  b.edit("name", "B draft");
  gate.resolve(jsonResponse(savedRow({ id: "gA", version: 2 })));
  await pending;
  assert.deepEqual(a.events.saved.map((event) => [event.id, event.saved.version]), [["gA", 2]], "the parent is told about item A");
  assert.deepEqual([b.state.version, b.state.draft.name, b.state.status, b.events.saved.length, b.requests.length], [10, "B draft", "idle", 0, 0], "item B is untouched");
});

test("a save response for the wrong item is not adopted: it becomes an unknown outcome and the token is kept", async () => {
  const h = createHarness({ responses: [jsonResponse(savedRow({ id: "someone-else", version: 99 }))] });
  h.edit("name", "Mine");
  await h.controller.save();
  assert.deepEqual([h.state.status, h.state.version, h.events.saved.length], ["unknown", 3, 0]);
});

test("in-flight locking: nothing can start or change while a reload or save is running", async () => {
  const gate = deferred<Response>();
  const h = createHarness({ responses: [stale(), () => gate.promise] });
  h.edit("name", "Mine");
  await h.controller.save();
  const reload = h.controller.loadLatest("reload");
  h.edit("name", "typed during reload");
  await h.controller.save();
  assert.equal(h.state.draft.name, "Mine", "edits during a reload are ignored, so the reload can not overwrite them");
  assert.equal(h.requests.length, 2, "and no save started");
  gate.resolve(jsonResponse([gearItem({ name: "Server", version: 5 })]));
  await reload;
  assert.deepEqual([h.state.draft.name, h.state.version], ["Server", 5]);
});

test("an ambiguous network failure is an UNKNOWN outcome: snapshot and token are kept, nothing retries automatically", async () => {
  const h = createHarness({ responses: [new TypeError("Failed to fetch")] });
  h.edit("name", "Maybe saved");
  await h.controller.save();
  assert.deepEqual([h.state.status, h.state.version, h.state.unknown?.version, h.state.unknown?.snapshot.name, canSave(h.state)], ["unknown", 3, 3, "Maybe saved", false]);
  assert.equal(h.requests.length, 1, "no automatic retry");
  assert.notEqual(h.state.status, "saving", "the editor can not stay stuck in the saving state");
  for (const failure of [jsonResponse({ error: "Admin request failed" }, 500), jsonResponse(savedRow({ version: "x" }))]) {
    const other = createHarness({ responses: [failure] });
    await other.controller.save();
    assert.equal(other.state.status, "unknown");
  }
});

test("retrySame re-sends the identical request with the identical token, even if the draft was edited in between", async () => {
  const h = createHarness({ responses: [new TypeError("offline"), jsonResponse(savedRow({ version: 4 }))] });
  h.edit("name", "Submitted");
  await h.controller.save();
  h.edit("name", "Edited after the failure");
  await h.controller.retrySame();
  assert.deepEqual(h.requests[1], h.requests[0], "same URL, same method, same body, same expectedVersion");
  assert.equal(h.requests[1].body?.expectedVersion, 3);
  assert.deepEqual([h.state.status, h.state.version, h.state.draft.name, isDirty(h.state)], ["saved", 4, "Edited after the failure", true], "the later edit is kept and is still unsaved");
});

test("a retry of a save that WAS applied is safely rejected as stale: it can never overwrite", async () => {
  const h = createHarness({ responses: [new TypeError("lost the response"), stale()] });
  h.edit("name", "Mine");
  await h.controller.save();
  await h.controller.retrySame();
  assert.deepEqual([h.state.status, h.state.version, h.state.draft.name], ["stale", 3, "Mine"]);
  assert.equal(h.events.saved.length, 0);
});

test("checking the latest state after an unknown outcome adopts a matching save, and otherwise never uses a newer token silently", async () => {
  const applied = createHarness({ responses: [new TypeError("lost"), jsonResponse([gearItem({ name: "Mine", version: 4 })])] });
  applied.edit("name", "Mine");
  await applied.controller.save();
  await applied.controller.loadLatest("check");
  assert.deepEqual([applied.state.status, applied.state.version, applied.state.info], ["saved", 4, MESSAGES.adopted]);
  assert.equal(applied.events.confirms.length, 0, "checking discards nothing, so it asks nothing");

  const someoneElse = createHarness({ responses: [new TypeError("lost"), jsonResponse([gearItem({ name: "Not mine", version: 9 })])] });
  someoneElse.edit("name", "Mine");
  await someoneElse.controller.save();
  await someoneElse.controller.loadLatest("check");
  assert.deepEqual([someoneElse.state.status, someoneElse.state.version, someoneElse.state.draft.name], ["stale", 3, "Mine"]);
});

test("authorization failures keep the draft and the token, are announced distinctly, and are never retried automatically", async () => {
  for (const status of [401, 403]) {
    const h = createHarness({ responses: [jsonResponse(errorBody(status === 401 ? "UNAUTHORIZED" : "FORBIDDEN"), status)] });
    h.edit("name", "Mine");
    await h.controller.save();
    assert.deepEqual([h.state.status, h.state.message, h.state.draft.name, h.state.version, h.requests.length], ["unauthorized", status === 401 ? MESSAGES.unauthenticated : MESSAGES.forbidden, "Mine", 3, 1], String(status));
    assert.equal(canSave(h.state), true, "the user can sign in again and save manually");
  }
});

test("a missing item (404) keeps the draft, explains it, and blocks saving", async () => {
  const h = createHarness({ responses: [jsonResponse(errorBody("NOT_FOUND"), 404)] });
  h.edit("name", "Mine");
  await h.controller.save();
  assert.deepEqual([h.state.status, h.state.message, h.state.draft.name, canSave(h.state)], ["missing", MESSAGES.notFound, "Mine", false]);
});

test("create mode keeps the existing POST contract: no expectedVersion, onCreated gets the item with its brand name", async () => {
  const h = createHarness({ item: gearItem(), mode: "create", brands: [{ id: "b1", name: "Acme" }], responses: [jsonResponse({ ...gearItem({ id: "new1", version: 0, brand: undefined }), brandId: "b1" }, 201)] });
  h.edit("name", "Brand new");
  h.edit("brandId", "b1");
  await h.controller.save();
  assert.deepEqual([h.requests[0].method, h.requests[0].url], ["POST", "/api/admin/gear"]);
  assert.equal("expectedVersion" in (h.requests[0].body ?? {}), false);
  assert.deepEqual(h.events.created.map((created) => [created.id, created.brand]), [["new1", { name: "Acme" }]]);
  assert.deepEqual([h.state.status, isDirty(h.state)], ["saved", false]);
});

test("create mode failures: an unreadable or failed create is reported, never left saving", async () => {
  const unreadable = createHarness({ mode: "create", responses: [jsonResponse({}, 201)] });
  unreadable.edit("name", "X"); unreadable.edit("brandId", "b1");
  await unreadable.controller.save();
  assert.deepEqual([unreadable.state.status, unreadable.state.message], ["error", MESSAGES.createUnknown]);
  const failed = createHarness({ mode: "create", responses: [jsonResponse({}, 400)] });
  failed.edit("name", "X"); failed.edit("brandId", "b1");
  await failed.controller.save();
  assert.equal(failed.state.message, MESSAGES.createFailed);
  const offline = createHarness({ mode: "create", responses: [new TypeError("x")] });
  offline.edit("name", "X"); offline.edit("brandId", "b1");
  await offline.controller.save();
  assert.deepEqual([offline.state.status, offline.state.message], ["error", MESSAGES.createUnknown]);
  assert.equal(failed.events.created.length + offline.events.created.length + unreadable.events.created.length, 0);
});

test("a save and a reload can not overlap either: whichever starts first owns the editor until it finishes", async () => {
  const gate = deferred<Response>();
  const h = createHarness({ responses: [stale(), () => gate.promise], lagged: true });
  h.edit("name", "Mine");
  h.flush();
  await h.controller.save();
  h.flush();
  const reload = h.controller.loadLatest("reload");      // starts a reload...
  const save = h.controller.save();                       // ...and a save clicked before the UI re-renders must not start
  const reloadAgain = h.controller.loadLatest("reload");
  assert.equal(h.requests.length, 2, "only the first save and the one reload were sent");
  gate.resolve(jsonResponse([gearItem({ name: "Server", version: 5 })]));
  await Promise.all([reload, save, reloadAgain]);
  assert.equal(h.requests.length, 2);
  assert.deepEqual([h.state.draft.name, h.state.version], ["Server", 5]);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Final-verification additions
// ---------------------------------------------------------------------------------------------------------------------------------

/** A Response whose `ok` getter throws: an unexpected failure inside the request layer that no classification anticipates. */
const brokenResponse = () => ({ get ok(): boolean { throw new Error("boom"); }, status: 200 }) as unknown as Response;

test("an unexpected exception inside a save can not leave the editor stuck in saving: it settles as an unconfirmed save and the next operation works", async () => {
  const h = createHarness({ responses: [() => Promise.resolve(brokenResponse()), jsonResponse(savedRow({ version: 4 }))] });
  h.edit("name", "Mine");
  await h.controller.save();
  assert.equal(h.state.status, "unknown", "not 'saving'");
  assert.deepEqual([h.state.unknown?.version, h.state.unknown?.snapshot.name], [3, "Mine"]);
  await h.controller.retrySame();                        // the in-flight flag was released, so a deliberate retry runs
  assert.deepEqual([h.state.status, h.state.version], ["saved", 4]);
});

test("an unexpected exception inside a reload can not leave the editor stuck in reloading: the draft is kept and the conflict is still shown", async () => {
  const h = createHarness({ responses: [stale(), () => Promise.resolve(brokenResponse())] });
  h.edit("name", "Mine");
  await h.controller.save();
  await h.controller.loadLatest("reload");
  assert.deepEqual([h.state.status, h.state.draft.name, h.state.version, h.state.message], ["stale", "Mine", 3, MESSAGES.reloadFailed]);
});

test("a throwing parent callback can not break the editor or block later saves", async () => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const throwing = createHarness({ responses: [jsonResponse(savedRow({ version: 4 })), jsonResponse(savedRow({ version: 5 }))] });
    // Same scripted server, but the parent callback throws.
    const { createEditorController } = await import("./gearEditorController");
    const { createEditorState, editorReducer } = await import("./gearEditorState");
    let state = createEditorState(gearItem(), "edit");
    const requests: unknown[] = [];
    const controller = createEditorController({
      getState: () => state,
      dispatch: (action) => { state = editorReducer(state, action); },
      fetchImpl: async (_url, init) => { requests.push(init?.body); return throwing.queue.shift() as Response; },
      confirm: () => true,
      callbacks: () => ({ brands: [], onSaved: () => { throw new Error("parent exploded"); } }),
    });
    state = editorReducer(state, { type: "edit", key: "name", value: "A" });
    await controller.save();
    assert.deepEqual([state.status, state.version], ["saved", 4], "the save is recorded even though the callback threw");
    state = editorReducer(state, { type: "edit", key: "name", value: "B" });
    await controller.save();
    assert.deepEqual([state.version, requests.length], [5, 2], "and the editor keeps working");
    assert.equal(logged.length, 2, "the callback failures were reported, not swallowed silently");
  } finally {
    console.error = original;
  }
});

test("an unrelated failure (brand creation, delete) while a conflict is showing leaves the conflict, the draft and the token alone", async () => {
  const h = createHarness({ responses: [stale()] });
  h.edit("name", "Mine");
  await h.controller.save();
  h.dispatch({ type: "localInvalid", message: "Brand creation failed. Check the brand name and try again." });
  h.dispatch({ type: "localInvalid", message: "Delete failed." });
  assert.deepEqual([h.state.status, h.state.version, h.state.draft.name, canSave(h.state), h.state.sideMessage], ["stale", 3, "Mine", false, "Delete failed."]);
  await h.controller.save();
  assert.equal(h.requests.length, 1, "Save still does nothing while stale");
});

test("check latest after an unconfirmed save: several writes since (version jumped) with matching fields is NOT adopted; exactly one is", async () => {
  const jumped = createHarness({ responses: [new TypeError("lost"), jsonResponse([gearItem({ name: "Mine", version: 5 })])] });
  jumped.edit("name", "Mine");
  await jumped.controller.save();
  await jumped.controller.loadLatest("check");
  assert.deepEqual([jumped.state.status, jumped.state.version, jumped.state.draft.name, canSave(jumped.state)], ["stale", 3, "Mine", false], "ambiguous: the user must recover explicitly");
  assert.deepEqual(jumped.events.reloaded.map((event) => event.item.version), [5], "the parent still learns the latest server copy");

  const exact = createHarness({ responses: [new TypeError("lost"), jsonResponse([gearItem({ name: "Mine", version: 4 })])] });
  exact.edit("name", "Mine");
  await exact.controller.save();
  await exact.controller.loadLatest("check");
  assert.deepEqual([exact.state.status, exact.state.version], ["saved", 4]);
});

test("a successful save leaves the editor clean, including after a retry and after an adopted check", async () => {
  const h = createHarness({ responses: [new TypeError("lost"), jsonResponse(savedRow({ version: 4 }))] });
  h.edit("name", "Mine");
  assert.equal(isDirty(h.state), true);
  await h.controller.save();
  await h.controller.retrySame();
  assert.deepEqual([h.state.status, isDirty(h.state)], ["saved", false]);
});

test("an editor that was switched away from (unmounted) can still finish its request, but its late, older response can not overwrite a newer catalog entry", async () => {
  const gate = deferred<Response>();
  const h = createHarness({ item: gearItem({ id: "g1", version: 3 }), responses: [() => gate.promise] });
  h.edit("name", "From the editor that is gone");
  const pending = h.controller.save();
  // The editor unmounts here (the user switched items). Meanwhile the catalog learned a NEWER copy of g1 (another save and a reload).
  const catalogEntry = gearItem({ id: "g1", name: "Newer", version: 6 });
  gate.resolve(jsonResponse(savedRow({ id: "g1", name: "From the editor that is gone", version: 4 })));
  await pending;
  assert.deepEqual(h.events.saved.map((event) => [event.id, event.saved.version]), [["g1", 4]], "the parent is told, by id");
  const merged = mergeSavedGearItem(catalogEntry, h.events.saved[0].saved);
  assert.equal(merged, catalogEntry, "and the older response changes nothing");
  assert.equal(merged.name, "Newer");
});
