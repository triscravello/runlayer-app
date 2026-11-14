import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { NextRequest } from "next/server";

// Route-level affiliate-link write validation: the real withAdmin chain, Zod schema, service and repository; only persistence
// (a recording fake) and the cookie store are faked. Same harness as adminGearRoute.test.ts. The stored item is legacy data.
process.env.BETTER_AUTH_SECRET = "test-only-secret-not-used-anywhere-else-0123456789";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never";

type Call = { where?: { id: string }; data: Record<string, unknown> };
const updates: Call[] = [];
const creates: Call[] = [];
const state: { cookie: string | undefined } = { cookie: undefined };
const stored = {
    id: "g1", name: "Trail Tee", brandId: "b1", genderTarget: null, category: "TOP", subcategory: null, priceRange: "MID",
    tags: ["light"], bodyTypeFit: [], imageUrl: "https://example.com/i.png", affiliateUrl: "javascript:legacy", createdAt: new Date(0), updatedAt: new Date(0),
    brand: { id: "b1" }, variants: [{ id: "v1", gearItemId: "g1", createdAt: new Date(0), updatedAt: new Date(0), label: "Default", gender: "unisex", affiliateUrl: "https://u:p@legacy.example/", imageUrl: null, price: null, sizes: [] }],
};
(globalThis as unknown as { prisma: unknown }).prisma = {
    user: { findUnique: async () => ({ id: "u1", email: "a@example.test", role: "ADMIN", sessionVersion: 1, createdAt: new Date(0), updatedAt: new Date(0) }) },
    gearItem: {
        findMany: async () => [stored],
        update: async (args: Call) => { updates.push(args); return { id: args.where?.id }; },
        create: async (args: Call) => { creates.push(args); return { id: "new" }; },
        delete: async () => { throw new Error("unexpected delete"); },
    },
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
mock.method(require("next/headers"), "cookies", async () => ({ get: (name: string) => (name === "runlayer_session" && state.cookie ? { name, value: state.cookie } : undefined) }));

async function signIn() {
    const { createSessionToken } = await import("@/lib/auth/crypto");
    state.cookie = createSessionToken("u1", 1);
    updates.length = 0;
    creates.length = 0;
}
async function patch(body: unknown) {
    await signIn();
    const { PATCH } = await import("@/app/api/admin/gear/[id]/route");
    return PATCH(new NextRequest("http://localhost/api/admin/gear/g1", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: "g1" }) });
}
async function post(body: unknown) {
    await signIn();
    const { POST } = await import("@/app/api/admin/gear/route");
    return POST(new NextRequest("http://localhost/api/admin/gear", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), undefined as never);
}
const variant = (affiliateUrl: unknown) => ({ label: "N", gender: "men", affiliateUrl });
const NEW_ITEM = { name: "Brand New", brandId: "b1", category: "TOP", priceRange: "MID" };
const UNSAFE = ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://x.example/a", "//x.example/a", "not a url", "https://u:p@x.example/a", "https://x.example/a b", " https://x.example/a", "https://x.example/a ", "\u0000", `https://x.example/${"a".repeat(2048)}`];

test("PATCH: an unsafe variant link is rejected with 400 and nothing is written", async () => {
    for (const value of UNSAFE) {
        const response = await patch({ variants: [variant(value)] });
        assert.equal(response.status, 400, value.slice(0, 30));
        assert.equal(updates.length, 0);
        assert.doesNotMatch(await response.text(), /alert\(1\)|passwd/);
    }
});

test("PATCH: valid links (any scheme case) are written as submitted; blank, null and omitted become null", async () => {
    const response = await patch({ variants: [variant("HTTPS://Shop.Example.com/x"), variant("http://shop.example.com/y"), variant(""), variant("  "), variant(null), { label: "O", gender: "men" }] });
    assert.equal(response.status, 200);
    const create = (updates[0].data.variants as { create: Array<Record<string, unknown>> }).create;
    assert.deepEqual(create.map((entry) => entry.affiliateUrl), ["HTTPS://Shop.Example.com/x", "http://shop.example.com/y", null, null, null, null]);
});

test("PATCH legacy: {name} succeeds although the stored item link and the stored variant link are unsafe", async () => {
    const response = await patch({ name: "Renamed" });
    assert.equal(response.status, 200);
    assert.equal(updates.length, 1);
    assert.equal("variants" in updates[0].data, false);
    assert.equal(updates[0].data.affiliateUrl, "javascript:legacy", "carried through unchanged");
});

test("PATCH legacy: variants: [] still succeeds, with a Default variant that does not inherit the unsafe stored link", async () => {
    const response = await patch({ variants: [] });
    assert.equal(response.status, 200);
    const create = (updates[0].data.variants as { create: Array<Record<string, unknown>> }).create;
    assert.deepEqual([create[0].label, create[0].affiliateUrl], ["Default", null]);
});

test("PATCH: variants: [] together with an unsafe item link that the request itself supplies is refused, with no write", async () => {
    const response = await patch({ variants: [], affiliateUrl: "https://u:p@x.example/" });
    assert.notEqual(response.status, 200);
    assert.ok(response.status >= 400);
    assert.equal(updates.length, 0);
});

test("POST: an unsafe variant link or an unsafe item link is rejected with 400 and nothing is created", async () => {
    for (const value of UNSAFE) {
        assert.equal((await post({ ...NEW_ITEM, variants: [variant(value)] })).status, 400, `variant ${value.slice(0, 30)}`);
        assert.equal((await post({ ...NEW_ITEM, affiliateUrl: value })).status, 400, `item ${value.slice(0, 30)}`);
        assert.equal(creates.length, 0);
    }
});

test("POST: valid links are created as submitted; blank variant links become null", async () => {
    const response = await post({ ...NEW_ITEM, variants: [variant("HTTPS://Shop.Example.com/x"), variant("")] });
    assert.equal(response.status, 201);
    assert.deepEqual((creates[0].data.variants as { create: Array<Record<string, unknown>> }).create.map((entry) => entry.affiliateUrl), ["HTTPS://Shop.Example.com/x", null]);
    const withItemLink = await post({ ...NEW_ITEM, affiliateUrl: "Http://shop.example.com/z" });
    assert.equal(withItemLink.status, 201);
    assert.equal((creates[0].data.variants as { create: Array<Record<string, unknown>> }).create[0].affiliateUrl, "Http://shop.example.com/z");
});
