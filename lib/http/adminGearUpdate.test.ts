import assert from "node:assert/strict";
import test from "node:test";
import { errorResponse } from "./apiErrors";
import { parseGearUpdateRequest } from "./adminGearUpdate";

// Route-level behavior of PATCH /api/admin/gear/[id] up to (not including) the service call, mapped through the same
// errorResponse the withAdmin wrapper uses. withAdmin itself needs a session and is exercised by the auth tests.
function patch(body: string) {
    return new Request("http://localhost/api/admin/gear/g1", { method: "PATCH", body, headers: { "content-type": "application/json" } });
}

async function statusOf(body: string, urlId = "g1") {
    try {
        await parseGearUpdateRequest(patch(body), urlId);
        return 200;
    } catch (error) {
        return errorResponse(error, "Admin request failed").status;
    }
}

test("a valid partial body is accepted", async () => {
    assert.deepEqual(await parseGearUpdateRequest(patch('{"name":"x"}'), "g1"), { name: "x" });
});

test("empty, non-meaningful, unknown-field and malformed bodies are 400", async () => {
    for (const body of ['{}', '{"id":"g1"}', '{"weatherSuitability":{}}', '{"name":"x","bogus":1}', '{"brand":{"connect":{"id":"x"}}}', '{ not json', '[]', 'null']) {
        assert.equal(await statusOf(body), 400, body);
    }
});

test("a body id that conflicts with the URL id is 400; a matching one is accepted", async () => {
    assert.equal(await statusOf('{"id":"other","name":"x"}', "g1"), 400);
    assert.equal(await statusOf('{"id":" g1 ","name":"x"}', "g1"), 200);
    assert.equal(await statusOf('{"name":"x"}', "g1"), 200);
});

test("the 400 for an id conflict names no ids", async () => {
    try {
        await parseGearUpdateRequest(patch('{"id":"secret-other","name":"x"}'), "g1");
        assert.fail("expected a rejection");
    } catch (error) {
        const body = await errorResponse(error).json();
        assert.equal(JSON.stringify(body).includes("secret-other"), false);
    }
});
