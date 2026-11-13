import assert from "node:assert/strict";
import test from "node:test";

// lib/prisma.ts reuses globalThis.prisma, so the route runs against this recording fake and never opens a database connection.
const calls: string[] = [];
const rows = [{ id: "g1", name: "Tee", brand: { id: "b1" }, variants: [] }];
const record = (name: string) => async () => { calls.push(name); throw new Error(`unexpected prisma call: ${name}`); };
(globalThis as unknown as { prisma: unknown }).prisma = {
    gearItem: {
        findMany: async () => { calls.push("gearItem.findMany"); return rows; },
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
