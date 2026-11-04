import assert from "node:assert/strict";
import test from "node:test";
import { registry } from "../metrics";
import {
    MAX_METRICS_TOKEN_LENGTH,
    MIN_METRICS_TOKEN_LENGTH,
    authorizeMetricsRequest,
    handleMetricsRequest,
    parseBearerToken,
    resolveMetricsAccess,
    tokensMatch,
    validateMetricsToken,
} from "./metricsAuth";

const TOKEN = "metrics-test-token-0123456789-abcdefghijklmnop";
const WRONG_SAME_LENGTH = "metrics-test-token-0123456789-abcdefghijklmnoq";

const production = { NODE_ENV: "production", METRICS_TOKEN: TOKEN };
const development = { NODE_ENV: "development" };

const bearer = (token: string) => `Bearer ${token}`;

function call(env: Record<string, string | undefined>, headers: Record<string, string> = {}) {
    let metricsCalls = 0;
    const request = new Request("http://localhost/api/metrics", { headers });

    const response = handleMetricsRequest(request, {
        env,
        metrics: async () => {
            metricsCalls += 1;
            return "# HELP sample sample\nsample 1\n";
        },
        contentType: "text/plain; version=0.0.4; charset=utf-8",
    });

    return { response, metricsCalls: () => metricsCalls };
}

// --- authorized -----------------------------------------------------------

test("the correct bearer token is authorized", () => {
    assert.deepEqual(authorizeMetricsRequest(bearer(TOKEN), production), { allowed: true });
    assert.deepEqual(authorizeMetricsRequest(`bearer ${TOKEN}`, production), { allowed: true }, "scheme is case-insensitive");
    assert.deepEqual(authorizeMetricsRequest(`BEARER ${TOKEN}`, production), { allowed: true });
});

test("an authorized request receives the metrics payload and content type unchanged", async () => {
    const { response, metricsCalls } = call(production, { authorization: bearer(TOKEN) });
    const result = await response;

    assert.equal(result.status, 200);
    assert.equal(await result.text(), "# HELP sample sample\nsample 1\n");
    assert.equal(result.headers.get("content-type"), "text/plain; version=0.0.4; charset=utf-8");
    assert.equal(metricsCalls(), 1);
});

test("the real Prometheus registry output is preserved for authorized requests", async () => {
    const result = await handleMetricsRequest(new Request("http://localhost/api/metrics", { headers: { authorization: bearer(TOKEN) } }), {
        env: production,
        metrics: () => registry.metrics(),
        contentType: registry.contentType,
    });

    const body = await result.text();
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("content-type"), registry.contentType);
    assert.match(body, /# HELP runlayer_http_requests_total/);
    assert.match(body, /# TYPE runlayer_rate_limit_backend_events_total counter/);
});

// --- rejected -------------------------------------------------------------

test("a missing Authorization header is rejected with 401 and no payload", async () => {
    const { response, metricsCalls } = call(production);
    const result = await response;

    assert.equal(result.status, 401);
    assert.equal(result.headers.get("www-authenticate"), "Bearer");
    assert.deepEqual(await result.json(), { error: "Unauthorized" });
    assert.equal(metricsCalls(), 0, "the registry is never read for unauthorized requests");
});

test("a wrong authentication scheme is rejected", () => {
    for (const header of [`Basic ${TOKEN}`, `Token ${TOKEN}`, `Digest ${TOKEN}`, TOKEN, `Bearer`, `Bearer `, `Bearerr ${TOKEN}`]) {
        assert.deepEqual(authorizeMetricsRequest(header, production), { allowed: false, status: 401 }, `rejected: ${header.slice(0, 12)}`);
    }
});

test("malformed Authorization headers are rejected", () => {
    for (const header of [`Bearer  ${TOKEN}`, `Bearer ${TOKEN} extra`, ` Bearer ${TOKEN}`, `Bearer ${TOKEN}\n`, `Bearer\t${TOKEN}`, `Bearer ${TOKEN},Bearer ${TOKEN}`]) {
        assert.deepEqual(authorizeMetricsRequest(header, production), { allowed: false, status: 401 }, `rejected: ${JSON.stringify(header.slice(0, 14))}`);
    }
});

test("incorrect tokens are rejected, including ones of the same length", () => {
    for (const token of [WRONG_SAME_LENGTH, TOKEN.toUpperCase(), TOKEN.toLowerCase().replace("m", "n")]) {
        assert.deepEqual(authorizeMetricsRequest(bearer(token), production), { allowed: false, status: 401 });
    }
});

test("tokens of different lengths are rejected safely", () => {
    const candidates = ["", "a", TOKEN.slice(0, -1), TOKEN.slice(0, 10), `${TOKEN}x`, `${TOKEN}${TOKEN}`, "x".repeat(10_000)];

    for (const candidate of candidates) {
        assert.doesNotThrow(() => tokensMatch(candidate, TOKEN));
        assert.equal(tokensMatch(candidate, TOKEN), false);
        assert.deepEqual(authorizeMetricsRequest(bearer(candidate), production), { allowed: false, status: 401 });
    }

    assert.equal(tokensMatch(TOKEN, TOKEN), true);
});

test("an oversized Authorization header is rejected without being compared", () => {
    assert.equal(parseBearerToken(`Bearer ${"a".repeat(5_000)}`), null);
    assert.deepEqual(authorizeMetricsRequest(`Bearer ${"a".repeat(5_000)}`, production), { allowed: false, status: 401 });
});

test("rejection responses never contain the token or any metrics", async () => {
    for (const env of [production, { NODE_ENV: "production" }]) {
        for (const headers of [{}, { authorization: bearer(WRONG_SAME_LENGTH) }] as Record<string, string>[]) {
            const { response, metricsCalls } = call(env, headers);
            const result = await response;
            const body = await result.text();

            assert.ok(!body.includes(TOKEN));
            assert.ok(!body.includes("sample"));
            assert.ok(![...result.headers.values()].some((value) => value.includes(TOKEN)));
            assert.equal(metricsCalls(), 0);
        }
    }
});

// --- configuration --------------------------------------------------------

test("production without a token returns 404 whatever the request carries", async () => {
    for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", METRICS_TOKEN: "" }, { NODE_ENV: "production", METRICS_TOKEN: "   " }]) {
        for (const headers of [{}, { authorization: bearer(TOKEN) }, { authorization: "Bearer " }] as Record<string, string>[]) {
            const { response, metricsCalls } = call(env, headers);
            const result = await response;

            assert.equal(result.status, 404);
            assert.equal(await result.text(), "");
            assert.equal(metricsCalls(), 0);
        }
    }
});

test("every non-development environment without a token is disabled, not open", () => {
    for (const NODE_ENV of ["production", "staging", "preview", "test", undefined]) {
        assert.deepEqual(resolveMetricsAccess({ NODE_ENV }), { mode: "disabled" }, `NODE_ENV=${String(NODE_ENV)}`);
        assert.deepEqual(authorizeMetricsRequest(null, { NODE_ENV }), { allowed: false, status: 404 });
    }
});

test("an invalid token disables the endpoint in every environment instead of exposing it", async () => {
    const invalid = ["short", "a".repeat(MIN_METRICS_TOKEN_LENGTH - 1), "a".repeat(MAX_METRICS_TOKEN_LENGTH + 1), `${"a".repeat(40)} with space`, `${"a".repeat(40)}!@#`, `${"a".repeat(40)}=x`];

    for (const NODE_ENV of ["production", "development"]) {
        for (const METRICS_TOKEN of invalid) {
            // Even a request presenting exactly the configured (invalid) token must not get through.
            const { response } = call({ NODE_ENV, METRICS_TOKEN }, { authorization: bearer(METRICS_TOKEN) });
            assert.equal((await response).status, 404, `NODE_ENV=${NODE_ENV} token=${JSON.stringify(METRICS_TOKEN.slice(0, 8))}`);
        }
    }
});

test("local development without a token stays open for the existing Prometheus workflow", async () => {
    const { response, metricsCalls } = call(development);
    const result = await response;

    assert.equal(result.status, 200);
    assert.equal(metricsCalls(), 1);
    assert.deepEqual(resolveMetricsAccess({ NODE_ENV: "development", METRICS_TOKEN: "" }), { mode: "open" });
});

test("local development with a token requires it", () => {
    const env = { NODE_ENV: "development", METRICS_TOKEN: TOKEN };

    assert.deepEqual(authorizeMetricsRequest(null, env), { allowed: false, status: 401 });
    assert.deepEqual(authorizeMetricsRequest(bearer(WRONG_SAME_LENGTH), env), { allowed: false, status: 401 });
    assert.deepEqual(authorizeMetricsRequest(bearer(TOKEN), env), { allowed: true });
});

test("surrounding whitespace in the configured token is ignored", () => {
    assert.deepEqual(authorizeMetricsRequest(bearer(TOKEN), { NODE_ENV: "production", METRICS_TOKEN: `  ${TOKEN}\n` }), { allowed: true });
});

// --- no IP dependence -----------------------------------------------------

test("the decision does not depend on forwarding headers or a loopback address", async () => {
    const spoofed = { "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1", forwarded: "for=127.0.0.1", host: "localhost" };

    assert.equal((await call(production, spoofed).response).status, 401);
    assert.equal((await call({ NODE_ENV: "production" }, spoofed).response).status, 404);
    assert.equal((await call(production, { ...spoofed, authorization: bearer(TOKEN) }).response).status, 200);
});

// --- token validation -----------------------------------------------------

test("validateMetricsToken accepts generated-style tokens and rejects weak or unsafe ones", () => {
    assert.equal(validateMetricsToken(TOKEN), null);
    assert.equal(validateMetricsToken("Abc+/123".repeat(8) + "=="), null, "base64 output from openssl rand -base64");
    assert.equal(validateMetricsToken("a".repeat(MIN_METRICS_TOKEN_LENGTH)), null);
    assert.equal(validateMetricsToken("a".repeat(MAX_METRICS_TOKEN_LENGTH)), null);

    for (const bad of ["", "short", "a".repeat(MIN_METRICS_TOKEN_LENGTH - 1), "a".repeat(MAX_METRICS_TOKEN_LENGTH + 1), "a b".repeat(20), "a".repeat(40) + "\n"]) {
        assert.notEqual(validateMetricsToken(bad), null);
    }
});

test("validation messages never contain the token", () => {
    const weak = "weak-secret-token";
    const message = validateMetricsToken(weak);

    assert.ok(message);
    assert.ok(!message.includes(weak));
});
