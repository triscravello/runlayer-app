import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { NextRequest } from "next/server";
import { createGearStore, knownRequestError, makeRow } from "../../test-support/gearStoreFake";

// HTTP error mapping for PATCH/DELETE /api/admin/gear/[id], through the real withAdmin -> session chain, route, service and
// repository, against the stateful in-memory fake (no database). Only 404 (missing item / Prisma P2025) and 409 (Prisma P2002 on
// update) are translated; every other failure keeps its existing response.
process.env.BETTER_AUTH_SECRET = "test-only-secret-not-used-anywhere-else-0123456789";

let store = createGearStore([]);
const state: { cookie: string | undefined } = { cookie: undefined };
(globalThis as unknown as { prisma: unknown }).prisma = {
    user: { findUnique: async () => ({ id: "u1", email: "a@example.test", role: "ADMIN", sessionVersion: 1, createdAt: new Date(0), updatedAt: new Date(0), profile: null }) },
    gearItem: new Proxy({}, { get: (_target, key) => (store.gearItem as Record<string, unknown>)[key as string] }),
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
mock.method(require("next/headers"), "cookies", async () => ({ get: (name: string) => (name === "runlayer_session" && state.cookie ? { name, value: state.cookie } : undefined) }));

async function call(method: "PATCH" | "DELETE", id: string, body?: string) {
    const { createSessionToken } = await import("@/lib/auth/crypto");
    state.cookie = createSessionToken("u1", 1);
    const route = await import("@/app/api/admin/gear/[id]/route");
    const request = new NextRequest(`http://localhost/api/admin/gear/${id}`, { method, body, headers: { "content-type": "application/json" } });
    const response = await route[method](request, { params: Promise.resolve({ id }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
}

const reset = () => { store = createGearStore([makeRow({ id: "g1" }), makeRow({ id: "g2", name: "Other Tee" })]); };

test("PATCH of a missing item is 404 with a fixed message and no id", async () => {
    reset();
    const { status, body } = await call("PATCH", "does-not-exist-123", '{"name":"x"}');
    assert.equal(status, 404);
    assert.deepEqual(body, { error: "Gear item not found", code: "NOT_FOUND" });
    assertNoLeak(body, ["g1"]);
    assert.equal(JSON.stringify(body).includes("does-not-exist-123"), false, "the requested id is not echoed");
    assert.equal(store.writes.length, 0);
});

test("PATCH whose row vanishes between lookup and write (Prisma P2025) is 404", async () => {
    reset();
    store.hooks.afterLookup = async () => { await store.gearItem.delete({ where: { id: "g1" } }); };
    const { status, body } = await call("PATCH", "g1", '{"name":"x"}');
    assert.equal(status, 404);
    assert.deepEqual(body, { error: "Gear item not found", code: "NOT_FOUND" });
    assertNoLeak(body, ["g1"]);
});

// Nothing from the request, the database or Prisma may appear in an error body.
const LEAKS = ["Other Tee", "g1", "brand_id", "b1", "fake P2", "P2002", "P2025", "P2003", "Prisma", "constraint", "meta", "target", "stack"];
function assertNoLeak(body: unknown, allowed: string[] = []) {
    const text = JSON.stringify(body);
    for (const needle of LEAKS) if (!allowed.includes(needle)) assert.equal(text.includes(needle), false, `response leaks ${needle}: ${text}`);
}

test("PATCH that violates the (name, brand) unique key (Prisma P2002) is 409 with no database detail", async () => {
    reset();
    const { status, body } = await call("PATCH", "g1", '{"name":"Other Tee"}');
    assertNoLeak(body);
    assert.equal(status, 409);
    assert.deepEqual(body, { error: "Gear item conflicts with an existing item", code: "CONFLICT" });
    assert.equal(store.get("g1")!.name, "Item g1", "nothing was written");
});

test("DELETE of a missing item (Prisma P2025) is 404; a normal DELETE still succeeds", async () => {
    reset();
    const missing = await call("DELETE", "nope");
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: "Gear item not found", code: "NOT_FOUND" });
    assertNoLeak(missing.body, ["g1"]);
    const ok = await call("DELETE", "g1");
    assert.deepEqual([ok.status, ok.body], [200, { success: true }]);
});

test("other failures keep their existing responses: invalid body stays 400, other database errors stay 500 and leak nothing", async () => {
    reset();
    assert.equal((await call("PATCH", "g1", '{"bogus":1}')).status, 400);
    assert.equal((await call("PATCH", "g1", "{}")).status, 400);

    const error = knownRequestError("P2003");
    store.hooks.beforeUpdate = () => { throw error; };
    const failed = await call("PATCH", "g1", '{"name":"x"}');
    assert.equal(failed.status, 500);
    assert.deepEqual(failed.body, { error: "Admin request failed" });
    assertNoLeak(failed.body, ["g1"]);

    store.hooks.beforeDelete = () => { throw knownRequestError("P2003"); };
    const blocked = await call("DELETE", "g2");
    assert.equal(blocked.status, 500, "a foreign-key refusal on DELETE is unchanged (cascade behavior is out of scope)");
    assert.deepEqual(blocked.body, { error: "Admin request failed" });

    store.hooks.beforeDelete = () => { throw knownRequestError("P2002"); };
    const unmapped = await call("DELETE", "g2");
    assert.equal(unmapped.status, 500, "P2002 is only mapped for updates");
    assert.deepEqual(unmapped.body, { error: "Admin request failed" });

    // A validation failure (zod, 400) names the offending field but never echoes the submitted value.
    const rejected = await call("PATCH", "g1", '{"category":"SECRET-VALUE-123"}');
    assert.equal(rejected.status, 400);
    assert.equal(JSON.stringify(rejected.body).includes("SECRET-VALUE-123"), false);
});
