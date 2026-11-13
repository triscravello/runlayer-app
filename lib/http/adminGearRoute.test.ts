import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { NextRequest } from "next/server";

// Route-level tests for PATCH /api/admin/gear/[id]: the real withAdmin -> requireAdmin -> session chain, the real parsing
// helper, schema, service and repository. Only the edges are faked: persistence (a recording fake in place of Prisma, so
// no database), and the request cookie store (next/headers cannot run outside a request). Tokens are genuinely signed.
// A fixed, obviously fake secret so tokens can be signed and verified in-process. Set before any auth module loads.
process.env.BETTER_AUTH_SECRET = "test-only-secret-not-used-anywhere-else-0123456789";

type Update = { where: { id: string }; data: Record<string, unknown> };
const updates: Update[] = [];
const state: { role: "ADMIN" | "USER"; sessionVersion: number; cookie: string | undefined } = { role: "ADMIN", sessionVersion: 1, cookie: undefined };

const stored = {
    id: "g1", name: "Trail Tee", brandId: "b1", genderTarget: null, category: "TOP", subcategory: null, priceRange: "MID",
    tags: ["light"], bodyTypeFit: [], imageUrl: "https://example.com/i.png", affiliateUrl: null, createdAt: new Date(0), updatedAt: new Date(0),
    brand: { id: "b1" }, variants: [{ id: "v1", gearItemId: "g1", createdAt: new Date(0), updatedAt: new Date(0), label: "Default", gender: "unisex", affiliateUrl: null, imageUrl: null, price: null, sizes: [] }],
};

(globalThis as unknown as { prisma: unknown }).prisma = {
    user: { findUnique: async () => ({ id: "u1", email: "a@example.test", role: state.role, sessionVersion: state.sessionVersion, createdAt: new Date(0), updatedAt: new Date(0), profile: null }) },
    gearItem: {
        findMany: async () => [stored],
        update: async (args: Update) => { updates.push(args); return { id: args.where.id }; },
        delete: async () => { throw new Error("unexpected delete"); },
    },
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
mock.method(require("next/headers"), "cookies", async () => ({ get: (name: string) => (name === "runlayer_session" && state.cookie ? { name, value: state.cookie } : undefined) }));

async function patch(body: string, { id = "g1", signedIn = true, role = "ADMIN" as "ADMIN" | "USER" } = {}) {
    const { createSessionToken } = await import("@/lib/auth/crypto");
    state.role = role;
    state.cookie = signedIn ? createSessionToken("u1", 1) : undefined;
    const { PATCH } = await import("@/app/api/admin/gear/[id]/route");
    const request = new NextRequest(`http://localhost/api/admin/gear/${id}`, { method: "PATCH", body, headers: { "content-type": "application/json" } });
    updates.length = 0;
    return PATCH(request, { params: Promise.resolve({ id }) });
}

test("an admin partial PATCH succeeds and changes only what was sent; variants are left alone", async () => {
    const response = await patch('{"name":"Renamed"}');
    assert.equal(response.status, 200);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].where, { id: "g1" });
    assert.equal(updates[0].data.name, "Renamed");
    assert.deepEqual(updates[0].data.tags, ["light"]);
    assert.equal(updates[0].data.imageUrl, "https://example.com/i.png");
    assert.equal("variants" in updates[0].data, false);
});

test("an admin can explicitly clear a nullable field and an array", async () => {
    const response = await patch('{"imageUrl":null,"tags":[]}');
    assert.equal(response.status, 200);
    assert.equal(updates[0].data.imageUrl, null);
    assert.deepEqual(updates[0].data.tags, []);
});

test("variants: [] keeps its approved meaning: a Default variant is synthesized from the item's own URLs", async () => {
    const response = await patch('{"variants":[]}');
    assert.equal(response.status, 200);
    assert.deepEqual(updates[0].data.variants, { deleteMany: {}, create: [{ label: "Default", gender: "unisex", affiliateUrl: null, imageUrl: "https://example.com/i.png", price: undefined, sizes: [] }] });
});

test("supplied variants replace the stored set exactly", async () => {
    const response = await patch('{"variants":[{"label":"Men","gender":"men"},{"label":"Women","gender":"women","sizes":["S"]}]}');
    assert.equal(response.status, 200);
    const create = (updates[0].data.variants as { create: Array<{ label: string; sizes: string[] }> }).create;
    assert.deepEqual(create.map((variant) => [variant.label, variant.sizes]), [["Men", []], ["Women", ["S"]]]);
});

const BAD_BODIES: Array<[string, string]> = [
    ["empty object", "{}"],
    ["only an id", '{"id":"g1"}'],
    ["empty weatherSuitability", '{"weatherSuitability":{}}'],
    ["unknown field", '{"name":"x","bogus":1}'],
    ["relation operation", '{"brand":{"connect":{"id":"x"}}}'],
    ["nested unknown variant field", '{"variants":[{"label":"a","gender":"men","gearItem":{"connect":{"id":"z"}}}]}'],
    ["conflicting body id", '{"id":"other","name":"x"}'],
    ["malformed JSON", "{ not json"],
];

for (const [label, body] of BAD_BODIES) {
    test(`admin PATCH with ${label} returns 400 and writes nothing`, async () => {
        const response = await patch(body);
        assert.equal(response.status, 400);
        assert.equal(updates.length, 0);
        assert.equal(JSON.stringify(await response.json()).includes("other"), false, "no ids echoed");
    });
}

test("a matching body id is accepted", async () => {
    assert.equal((await patch('{"id":"g1","name":"x"}')).status, 200);
});

test("an unauthenticated PATCH is 401 and a non-admin is 403, before any parsing or write", async () => {
    assert.equal((await patch('{"name":"x"}', { signedIn: false })).status, 401);
    assert.equal(updates.length, 0);
    assert.equal((await patch('{"name":"x"}', { role: "USER" })).status, 403);
    assert.equal(updates.length, 0);
    // Even an invalid body is answered by the auth layer first, so it learns nothing about validation.
    assert.equal((await patch("{}", { signedIn: false })).status, 401);
});
