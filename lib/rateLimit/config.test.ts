import assert from "node:assert/strict";
import test from "node:test";
import { resolveRateLimitConfig } from "./config";

const UPSTASH_ENV = {
    RATE_LIMIT_BACKEND: "upstash",
    UPSTASH_REDIS_REST_URL: "https://example.invalid",
    UPSTASH_REDIS_REST_TOKEN: "placeholder-token-value",
};

test("outside production the backend defaults to memory", () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
        assert.deepEqual(resolveRateLimitConfig({ NODE_ENV }), { ok: true, config: { backend: "memory" } });
    }
    assert.deepEqual(resolveRateLimitConfig({ NODE_ENV: "development", RATE_LIMIT_BACKEND: "  " }), { ok: true, config: { backend: "memory" } });
});

test("unset Upstash credentials do not enable Upstash implicitly", () => {
    const result = resolveRateLimitConfig({
        NODE_ENV: "development",
        UPSTASH_REDIS_REST_URL: "https://example.invalid",
        UPSTASH_REDIS_REST_TOKEN: "placeholder-token-value",
    });

    assert.deepEqual(result, { ok: true, config: { backend: "memory" } });
});

test("production rejects a missing backend instead of choosing one", () => {
    for (const RATE_LIMIT_BACKEND of [undefined, "", "   "]) {
        const result = resolveRateLimitConfig({ NODE_ENV: "production", RATE_LIMIT_BACKEND });

        assert.equal(result.ok, false);
        assert.match(result.ok ? "" : result.error, /RATE_LIMIT_BACKEND/);
    }
});

test("an explicit memory backend is accepted in production, case-insensitively", () => {
    assert.deepEqual(resolveRateLimitConfig({ NODE_ENV: "production", RATE_LIMIT_BACKEND: "memory" }), { ok: true, config: { backend: "memory" } });
    assert.deepEqual(resolveRateLimitConfig({ NODE_ENV: "production", RATE_LIMIT_BACKEND: " MEMORY " }), { ok: true, config: { backend: "memory" } });
});

test("upstash requires both credentials in every environment", () => {
    for (const NODE_ENV of ["production", "development", undefined]) {
        for (const missing of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"] as const) {
            const result = resolveRateLimitConfig({ ...UPSTASH_ENV, NODE_ENV, [missing]: undefined });
            assert.equal(result.ok, false, `${missing} missing in NODE_ENV=${String(NODE_ENV)}`);
        }

        assert.equal(resolveRateLimitConfig({ ...UPSTASH_ENV, NODE_ENV, UPSTASH_REDIS_REST_TOKEN: "   " }).ok, false);
    }
});

test("a complete upstash configuration is accepted", () => {
    assert.deepEqual(resolveRateLimitConfig({ ...UPSTASH_ENV, NODE_ENV: "production" }), {
        ok: true,
        config: { backend: "upstash", url: "https://example.invalid", token: "placeholder-token-value" },
    });
});

test("unknown backend values are rejected in every environment", () => {
    for (const NODE_ENV of ["production", "development", undefined]) {
        for (const RATE_LIMIT_BACKEND of ["redis", "off", "none", "true", "memory,upstash"]) {
            assert.equal(resolveRateLimitConfig({ NODE_ENV, RATE_LIMIT_BACKEND }).ok, false);
        }
    }
});

test("configuration errors never contain credential values", () => {
    const results = [
        resolveRateLimitConfig({ ...UPSTASH_ENV, UPSTASH_REDIS_REST_URL: undefined }),
        resolveRateLimitConfig({ ...UPSTASH_ENV, UPSTASH_REDIS_REST_TOKEN: undefined }),
        resolveRateLimitConfig({ ...UPSTASH_ENV, RATE_LIMIT_BACKEND: "bogus" }),
    ];

    for (const result of results) {
        assert.equal(result.ok, false);
        const error = result.ok ? "" : result.error;
        assert.ok(!error.includes("placeholder-token-value"));
        assert.ok(!error.includes("example.invalid"));
    }
});
