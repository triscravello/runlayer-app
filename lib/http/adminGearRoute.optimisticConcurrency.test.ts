import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { createGearStore, makeRow } from "../../test-support/gearStoreFake";

// PATCH /api/admin/gear/[id] with the optimistic-concurrency token, through the REAL withAdmin -> session chain, route, schema, service and
// repository. Only the edges are faked: persistence (the stateful in-memory Prisma fake, no database) and the request cookie store.
// The fake models row locking; the real-PostgreSQL behavior is covered by the opt-in integration test.
process.env.BETTER_AUTH_SECRET = "test-only-secret-not-used-anywhere-else-0123456789";

let store = createGearStore([]);
const state: { role: "ADMIN" | "USER"; cookie: string | undefined; userLookups: number } = { role: "ADMIN", cookie: undefined, userLookups: 0 };
(globalThis as unknown as { prisma: unknown }).prisma = {
    user: { findUnique: async () => { state.userLookups += 1; return { id: "u1", email: "a@example.test", role: state.role, sessionVersion: 1, createdAt: new Date(0), updatedAt: new Date(0), profile: null }; } },
    $transaction: (fn: never) => (store.$transaction as (fn: never) => unknown)(fn),
    gearItem: new Proxy({}, { get: (_target, key) => (store.gearItem as Record<string, unknown>)[key as string] }),
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
mock.method(require("next/headers"), "cookies", async () => ({ get: (name: string) => (name === "runlayer_session" && state.cookie ? { name, value: state.cookie } : undefined) }));

const reset = () => { store = createGearStore([makeRow({ id: "g1" }), makeRow({ id: "g2", name: "Other Tee" })]); state.role = "ADMIN"; state.userLookups = 0; };

async function patch(body: string, { id = "g1", signedIn = true, role = "ADMIN" as "ADMIN" | "USER" } = {}) {
    const { createSessionToken } = await import("@/lib/auth/crypto");
    state.role = role;
    state.cookie = signedIn ? createSessionToken("u1", 1) : undefined;
    const route = await import("@/app/api/admin/gear/[id]/route");
    const request = new NextRequest(`http://localhost/api/admin/gear/${id}`, { method: "PATCH", body, headers: { "content-type": "application/json" } });
    const response = await route.PATCH(request, { params: Promise.resolve({ id }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
}

// Nothing from the request, the database or Prisma may appear in an error body.
const LEAKS = ["g1", "brand_id", "b1", "fake P2", "P2002", "P2025", "P2028", "P2003", "Prisma", "constraint", "meta", "target", "stack", "SECRET-TOKEN-VALUE", "Other Tee", "version"];
function assertNoLeak(body: unknown, allowed: string[] = []) {
    const text = JSON.stringify(body);
    for (const needle of LEAKS) if (!allowed.includes(needle)) assert.equal(text.includes(needle), false, `response leaks ${needle}: ${text}`);
}

test("A. a valid expectedVersion is forwarded as a condition (service options), never as update data", async () => {
    reset();
    const { status, body } = await patch('{"name":"Renamed","expectedVersion":0}');
    assert.equal(status, 200);
    assert.deepEqual(store.updateManyCalls[0].where, { id: "g1", version: 0 }, "the token became the version condition");
    assert.equal("expectedVersion" in store.updateManyCalls[0].data, false, "and is not part of the data written");
    assert.equal("version" in store.updateManyCalls[0].data && JSON.stringify(store.updateManyCalls[0].data.version), JSON.stringify({ increment: 1 }), "version only ever moves by the server's own increment");
    assert.deepEqual(Object.keys(store.writes[0].data!), ["name"], "only the supplied gear field was written");
    assert.equal(store.writes[0].expectedVersion, 0);
    assert.equal(body.name, "Renamed");
});

test("B. without expectedVersion the update stays unconditional (last write wins) and still increments the version", async () => {
    reset();
    const first = await patch('{"name":"One"}');
    const second = await patch('{"name":"Two"}');
    assert.deepEqual([first.status, second.status], [200, 200]);
    assert.deepEqual(store.updateManyCalls.map((call) => call.where), [{ id: "g1" }, { id: "g1" }], "no version condition");
    assert.deepEqual([first.body.version, second.body.version], [1, 2]);
    assert.equal(store.get("g1")!.name, "Two");
});

test("C. invalid expectedVersion values are 400 before any database access, without echoing the value", async () => {
    reset();
    const invalid = ['"1"', '"SECRET-TOKEN-VALUE"', "null", "-1", "1.5", "2147483648", "1e999", "true", "[0]", "{}", '""', "9007199254740993"];
    for (const token of invalid) {
        const { status, body } = await patch(`{"name":"x","expectedVersion":${token}}`);
        assert.equal(status, 400, token);
        assertNoLeak(body, ["g1", "version"]);
    }
    assert.deepEqual(store.calls, [], "no transaction, no read, no write");
    assert.equal(store.writes.length, 0);
    const { updateGearItemSchema } = await import("@/lib/validation/adminGear");
    for (const token of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        assert.equal(updateGearItemSchema.safeParse({ name: "x", expectedVersion: token }).success, false, String(token));
    }
    for (const token of [0, 1, 2_147_483_647]) assert.equal(updateGearItemSchema.safeParse({ name: "x", expectedVersion: token }).success, true, String(token));
});

test("D. expectedVersion alone is an empty update: 400, no database access", async () => {
    reset();
    for (const body of ['{"expectedVersion":0}', '{"expectedVersion":3,"id":"g1"}', '{"expectedVersion":0,"weatherSuitability":{}}', '{"expectedVersion":0,"externalId":"x"}']) {
        const { status } = await patch(body);
        assert.equal(status, 400, body);
    }
    assert.deepEqual(store.calls, []);
});

test("E. a stale token is 409 STALE_VERSION with a fixed body and no durable write", async () => {
    reset();
    await patch('{"name":"First","expectedVersion":0}');
    const before = structuredClone(store.get("g1"));
    const { status, body } = await patch('{"name":"Second","tags":["x"],"variants":[{"label":"V","gender":"men"}],"expectedVersion":0}');
    assert.equal(status, 409);
    assert.deepEqual(body, { error: "Gear item was changed by someone else", code: "STALE_VERSION" });
    assertNoLeak(body);
    assert.deepEqual(store.get("g1"), before, "nothing changed: scalars, version and variants");
});

test("F. a missing item is 404 NOT_FOUND, with or without a token, and is never reported as stale", async () => {
    reset();
    for (const body of ['{"name":"x"}', '{"name":"x","expectedVersion":0}', '{"name":"x","expectedVersion":7}']) {
        const response = await patch(body, { id: "does-not-exist-123" });
        assert.equal(response.status, 404, body);
        assert.deepEqual(response.body, { error: "Gear item not found", code: "NOT_FOUND" });
        assert.equal(JSON.stringify(response.body).includes("does-not-exist-123"), false, "the requested id is not echoed");
    }
});

test("G. a uniqueness conflict stays 409 CONFLICT, distinct from STALE_VERSION, and rolls back", async () => {
    reset();
    const { status, body } = await patch('{"name":"Other Tee","expectedVersion":0}');
    assert.equal(status, 409);
    assert.deepEqual(body, { error: "Gear item conflicts with an existing item", code: "CONFLICT" });
    assertNoLeak(body);
    assert.equal(store.get("g1")!.version, 0);
    assert.equal(store.get("g1")!.name, "Item g1");
});

test("H. a transaction timeout (P2028) is neither stale nor missing: it stays an unmapped 500 with the generic body", async () => {
    reset();
    const timeout = new Prisma.PrismaClientKnownRequestError("fake timeout: Transaction already closed", { code: "P2028", clientVersion: "test" });
    for (const body of ['{"name":"x","expectedVersion":0}', '{"name":"x"}']) {
        store.hooks.afterLock = () => { throw timeout; };
        const response = await patch(body);
        assert.equal(response.status, 500, body);
        assert.deepEqual(response.body, { error: "Admin request failed" });
        assertNoLeak(response.body);
    }
    assert.equal(store.get("g1")!.version, 0, "rolled back");
});

test("I. a successful PATCH returns the updated row including its new version, with the existing fields intact", async () => {
    reset();
    const { status, body } = await patch('{"tags":["a","b"],"expectedVersion":0}');
    assert.equal(status, 200);
    assert.equal(body.version, 1, "the new token");
    for (const field of ["id", "name", "brandId", "category", "priceRange", "genderTarget", "subcategory", "imageUrl", "affiliateUrl", "weatherHot", "weatherCold", "tags", "bodyTypeFit"]) {
        assert.ok(field in body, `the previously returned field ${field} is still present`);
    }
    assert.deepEqual(body.tags, ["a", "b"]);
    // The returned version is exactly what the next save must send.
    assert.equal((await patch('{"name":"Next","expectedVersion":1}')).status, 200);
    assert.equal((await patch('{"name":"Stale","expectedVersion":1}')).status, 409);
});

test("K. sparse PATCH, affiliate URL containment and weatherSuitability.hot: null are unchanged under a token", async () => {
    reset();
    // Sparse: only what was sent is written; null clears; [] replaces.
    await patch('{"imageUrl":null,"tags":[],"expectedVersion":0}');
    assert.deepEqual(Object.keys(store.writes[0].data!).sort(), ["imageUrl", "tags"]);
    assert.equal(store.get("g1")!.subcategory, "tee");

    // A legacy unsafe stored item link does not block an unrelated tokened edit, and is neither rewritten nor copied into a Default.
    reset();
    store = createGearStore([makeRow({ id: "g1", affiliateUrl: "javascript:legacy" })]);
    assert.equal((await patch('{"name":"Renamed","expectedVersion":0}')).status, 200);
    assert.equal(store.get("g1")!.affiliateUrl, "javascript:legacy");
    assert.equal((await patch('{"variants":[],"expectedVersion":1}')).status, 200);
    assert.equal(store.get("g1")!.variants[0].affiliateUrl, null, "the unsafe stored link is not copied into the new Default");
    // ...while an unsafe link that IS supplied is still refused before any write.
    const calls = store.calls.length;
    assert.equal((await patch('{"affiliateUrl":"javascript:alert(1)","expectedVersion":2}')).status, 400);
    assert.equal(store.calls.length, calls);

    // hot: null alone keeps its existing meaning: accepted, writes no weather column, only the version moves.
    reset();
    const hot = await patch('{"weatherSuitability":{"hot":null},"expectedVersion":0}');
    assert.equal(hot.status, 200);
    assert.equal(store.get("g1")!.weatherHot, 0.4);
    assert.equal(store.get("g1")!.version, 1);
});

test("L. authorization is unchanged: a token never bypasses authentication or the admin role, and nothing is read or written", async () => {
    reset();
    const unauthenticated = await patch('{"name":"x","expectedVersion":0}', { signedIn: false });
    assert.equal(unauthenticated.status, 401);
    const notAdmin = await patch('{"name":"x","expectedVersion":0}', { role: "USER" });
    assert.equal(notAdmin.status, 403);
    for (const response of [unauthenticated, notAdmin]) assertNoLeak(response.body, ["g1"]);
    assert.deepEqual(store.calls, [], "the gear store was never touched");
    assert.equal(store.writes.length, 0);

    // A body id that disagrees with the URL is still refused, token or not.
    reset();
    assert.equal((await patch('{"id":"g2","name":"x","expectedVersion":0}')).status, 400);
    assert.deepEqual(store.calls, []);
});

test("DELETE is unchanged by the token work: missing is 404, success is {success: true}", async () => {
    reset();
    const { createSessionToken } = await import("@/lib/auth/crypto");
    state.cookie = createSessionToken("u1", 1);
    const route = await import("@/app/api/admin/gear/[id]/route");
    const call = async (id: string) => { const response = await route.DELETE(new NextRequest(`http://localhost/api/admin/gear/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) }); return { status: response.status, body: await response.json() }; };
    assert.deepEqual(await call("nope"), { status: 404, body: { error: "Gear item not found", code: "NOT_FOUND" } });
    assert.deepEqual(await call("g1"), { status: 200, body: { success: true } });
});
