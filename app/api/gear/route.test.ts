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

// A catalog row exactly as Prisma returns it today (every column of the item, its brand and its variants), plus the internal
// `version` counter and some hostile extras. `version` must never reach the public JSON, at any depth.
const FULL_ROW = {
    id: "g9", name: "Full", brandId: "b9", genderTarget: "men", category: "TOP", subcategory: "tee", priceRange: "MID", tags: ["light"],
    weatherHot: 0.4, weatherCold: 0.1, weatherRain: null, weatherWind: 0.2, bodyTypeFit: ["slim"], imageUrl: "https://example.com/i.png",
    affiliateUrl: "https://example.com/buy", createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    version: 7,
    brand: { id: "b9", name: "Acme", normalizedName: "acme", tier: "premium", style: null, createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-02T00:00:00.000Z"), version: 3, internalNote: "brand-secret" },
    variants: [
        { id: "v9", gearItemId: "g9", label: "Default", gender: "unisex", affiliateUrl: "https://example.com/buy", imageUrl: null, price: 20, sizes: ["M"], createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z"), version: 9, internalNote: "variant-secret" },
    ],
    internalNote: "item-secret",
};

function hasKeyAnywhere(value: unknown, key: string): boolean {
    if (Array.isArray(value)) return value.some((entry) => hasKeyAnywhere(entry, key));
    if (typeof value === "object" && value !== null) return Object.entries(value).some(([name, entry]) => name === key || hasKeyAnywhere(entry, key));
    return false;
}

test("J. GET /api/gear never returns version (item, brand or variant level) and keeps every intended public field", async () => {
    const route = await routePromise;
    dataset = [FULL_ROW];
    try {
        const response = await route.GET();
        assert.equal(response.status, 200);
        const json = (await response.json()) as Array<Record<string, unknown>>;
        assert.equal(hasKeyAnywhere(json, "version"), false, "no `version` key at any depth");
        assert.equal(JSON.stringify(json).includes("secret"), false, "and no unlisted column leaks either: the response is an allow-list");

        // Everything that was public before `version` existed is still there, with the same values.
        const expected = JSON.parse(JSON.stringify(FULL_ROW)) as Record<string, unknown>;
        delete expected.version; delete expected.internalNote;
        delete (expected.brand as Record<string, unknown>).version; delete (expected.brand as Record<string, unknown>).internalNote;
        for (const variant of expected.variants as Array<Record<string, unknown>>) { delete variant.version; delete variant.internalNote; }
        assert.deepEqual(json[0], expected);
    } finally {
        dataset = rows;
    }
});

test("J2. the public response is unchanged for rows without version: same keys, same values", async () => {
    const route = await routePromise;
    const legacy = JSON.parse(JSON.stringify(FULL_ROW)) as Record<string, unknown>;
    delete legacy.version; delete legacy.internalNote;
    delete (legacy.brand as Record<string, unknown>).version; delete (legacy.brand as Record<string, unknown>).internalNote;
    for (const variant of legacy.variants as Array<Record<string, unknown>>) { delete variant.version; delete variant.internalNote; }
    dataset = [legacy];
    try {
        assert.deepEqual(await (await route.GET()).json(), [legacy]);
    } finally {
        dataset = rows;
    }
});

test("J3. a malformed variants array can not crash the public catalog or leak: junk entries are dropped, valid ones keep their order and their containment", async () => {
    const route = await routePromise;
    dataset = [{ id: "g7", name: "Odd", brand: { id: "b1" }, variants: [null, { id: "v1", label: "A", version: 2, affiliateUrl: "javascript:x" }, "x", { id: "v2", label: "B" }] }];
    try {
        const response = await route.GET();
        assert.equal(response.status, 200);
        const json = (await response.json()) as Array<{ variants: Array<Record<string, unknown>> }>;
        assert.deepEqual(json[0].variants, [{ id: "v1", label: "A", affiliateUrl: null }, { id: "v2", label: "B" }]);
    } finally {
        dataset = rows;
    }
});
