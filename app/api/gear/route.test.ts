import assert from "node:assert/strict";
import test from "node:test";

// lib/prisma.ts reuses globalThis.prisma, so the route runs against this recording fake and never opens a database connection.
const calls: string[] = [];
const rows = [{ id: "g1", name: "Tee", brand: { id: "b1" }, variants: [] }];
let dataset: unknown[] = rows;
const record = (name: string) => async () => { calls.push(name); throw new Error(`unexpected prisma call: ${name}`); };
(globalThis as unknown as { prisma: unknown }).prisma = {
    gearItem: {
        findMany: async () => { calls.push("gearItem.findMany"); return dataset; },
        create: record("gearItem.create"),
        update: record("gearItem.update"),
        delete: record("gearItem.delete"),
        upsert: record("gearItem.upsert"),
    },
    $transaction: record("$transaction"),
};

const routePromise = import("./route");

function bodyRequest(method: string, body: string) {
    return new Request("http://localhost/api/gear", { method, body, headers: { "content-type": "application/json" } });
}

const MALICIOUS = JSON.stringify({ id: "g1", brand: { connect: { id: "x" } }, OutfitItem: { deleteMany: {} }, variants: { deleteMany: {} } });

for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
    test(`${method} /api/gear returns 405 with an accurate Allow header and no body consumption`, async () => {
        const route = await routePromise;
        const request = bodyRequest(method, MALICIOUS);
        calls.length = 0;
        const response = await (route[method] as (request: Request) => Response | Promise<Response>)(request);

        assert.equal(response.status, 405);
        assert.equal(response.headers.get("allow"), "GET, HEAD, OPTIONS");
        assert.equal(request.bodyUsed, false, "request body must not be read");
        assert.deepEqual(calls, [], "no database access");
        assert.deepEqual(await response.json(), { error: "Method not allowed" });
    });

    test(`${method} /api/gear ignores malformed JSON without error or writes`, async () => {
        const route = await routePromise;
        const request = bodyRequest(method, "{ not json");
        calls.length = 0;
        const response = await (route[method] as (request: Request) => Response | Promise<Response>)(request);

        assert.equal(response.status, 405);
        assert.equal(request.bodyUsed, false);
        assert.deepEqual(calls, []);
    });
}

test("OPTIONS advertises only the public methods", async () => {
    const route = await routePromise;
    const response = route.OPTIONS();
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("allow"), "GET, HEAD, OPTIONS");
});

test("route exports exactly the public read plus the disabled legacy methods", async () => {
    const route = await routePromise;
    assert.deepEqual(Object.keys(route).sort(), ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"]);
});

test("GET /api/gear stays public and returns the catalog", async () => {
    const route = await routePromise;
    calls.length = 0;
    const response = await route.GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), rows);
    assert.deepEqual(calls, ["gearItem.findMany"]);
});

test("GET /api/gear removes unsafe affiliate links from the public JSON and leaves stored rows and safe links alone", async () => {
    const route = await routePromise;
    const stored = [
        { id: "g2", name: "Legacy", imageUrl: "https://example.com/i.png", affiliateUrl: "javascript:alert(1)", brand: { id: "b1" }, variants: [
            { id: "v1", label: "A", gender: "men", affiliateUrl: "data:text/html,x" },
            { id: "v2", label: "B", gender: "women", affiliateUrl: "https://example.com/buy" },
            { id: "v3", label: "C", gender: "unisex", affiliateUrl: "https://user:pw@example.com/x" },
            { id: "v4", label: "D", gender: "unisex", affiliateUrl: "" },
            { id: "v5", label: "E", gender: "unisex", affiliateUrl: null },
        ] },
        { id: "g3", name: "Clean", affiliateUrl: "https://example.com/p", brand: { id: "b1" }, variants: [] },
    ];
    const snapshot = JSON.parse(JSON.stringify(stored));
    dataset = stored;
    try {
        const response = await route.GET();
        assert.equal(response.status, 200);
        const json = (await response.json()) as typeof stored;

        assert.equal(json[0].affiliateUrl, null);
        assert.deepEqual(json[0].variants.map((variant) => variant.affiliateUrl), [null, "https://example.com/buy", null, "", null]);
        assert.equal(json[0].imageUrl, "https://example.com/i.png");
        assert.deepEqual(json[1], snapshot[1], "a row with only safe links is returned unchanged");
        assert.equal(JSON.stringify(json).match(/javascript:|data:text|user:pw/), null, "no unsafe link appears anywhere in the JSON");
        assert.deepEqual(JSON.parse(JSON.stringify(stored)), snapshot, "the stored rows are not modified");
    } finally {
        dataset = rows;
    }
});
