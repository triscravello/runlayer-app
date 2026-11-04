import assert from "node:assert/strict";
import test from "node:test";
import { validateEnv } from "./envValidation";

const STRONG_SECRET = "a-strong-test-secret-with-more-than-32-chars";

const validProduction = {
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: STRONG_SECRET,
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    WEATHER_API_KEY: "weather-key",
    RATE_LIMIT_BACKEND: "memory",
    CLIENT_IP_STRATEGY: "xff-hops:1",
};

test("a complete production environment has no problems", () => {
    assert.deepEqual(validateEnv(validProduction), []);
});

test("development only needs DATABASE_URL", () => {
    assert.deepEqual(validateEnv({ NODE_ENV: "development", DATABASE_URL: "postgresql://localhost/db" }), []);
    assert.deepEqual(validateEnv({ NODE_ENV: "development" }), ["Missing DATABASE_URL"]);
});

test("production reports every missing required variable", () => {
    const problems = validateEnv({ NODE_ENV: "production" });

    assert.equal(problems.length, 5);
    assert.ok(problems.some((problem) => problem.includes("BETTER_AUTH_SECRET")));
    assert.ok(problems.includes("Missing DATABASE_URL"));
    assert.ok(problems.includes("Missing WEATHER_API_KEY"));
    assert.ok(problems.some((problem) => problem.includes("RATE_LIMIT_BACKEND")));
    assert.ok(problems.some((problem) => problem.includes("CLIENT_IP_STRATEGY")));
});

test("production requires an explicit, valid client-IP strategy", () => {
    const { CLIENT_IP_STRATEGY: _omitted, ...withoutStrategy } = validProduction;
    void _omitted;

    assert.ok(validateEnv(withoutStrategy).some((problem) => problem.includes("CLIENT_IP_STRATEGY")));
    assert.ok(validateEnv({ ...validProduction, CLIENT_IP_STRATEGY: "x-forwarded-for" }).some((problem) => problem.includes("CLIENT_IP_STRATEGY")));
    assert.ok(validateEnv({ ...validProduction, CLIENT_IP_STRATEGY: "xff-hops:0" }).some((problem) => problem.includes("CLIENT_IP_STRATEGY")));
    assert.deepEqual(validateEnv({ ...validProduction, CLIENT_IP_STRATEGY: "none" }), []);
    assert.deepEqual(validateEnv({ ...validProduction, CLIENT_IP_STRATEGY: "header:x-real-ip" }), []);
});

test("production requires an explicit, complete rate-limit backend", () => {
    const { RATE_LIMIT_BACKEND: _omitted, ...withoutBackend } = validProduction;
    void _omitted;

    assert.ok(validateEnv(withoutBackend).some((problem) => problem.includes("RATE_LIMIT_BACKEND")));
    assert.ok(validateEnv({ ...validProduction, RATE_LIMIT_BACKEND: "redis" }).some((problem) => problem.includes("RATE_LIMIT_BACKEND")));
    assert.ok(validateEnv({ ...validProduction, RATE_LIMIT_BACKEND: "upstash" }).some((problem) => problem.includes("UPSTASH_REDIS_REST_URL")));
    assert.deepEqual(
        validateEnv({
            ...validProduction,
            RATE_LIMIT_BACKEND: "upstash",
            UPSTASH_REDIS_REST_URL: "https://example.invalid",
            UPSTASH_REDIS_REST_TOKEN: "placeholder-token",
        }),
        [],
    );
});

test("METRICS_TOKEN is optional, but a value that is set must be valid", () => {
    const strong = "metrics-test-token-0123456789-abcdefghijklmnop";

    assert.deepEqual(validateEnv(validProduction), [], "an unset token only disables the endpoint");
    assert.deepEqual(validateEnv({ ...validProduction, METRICS_TOKEN: strong }), []);
    assert.deepEqual(validateEnv({ ...validProduction, METRICS_TOKEN: "   " }), []);

    const weak = "too-short-token";
    const problems = validateEnv({ ...validProduction, METRICS_TOKEN: weak });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /METRICS_TOKEN/);
    assert.ok(!problems[0].includes(weak), "the message never contains the token");
    assert.ok(validateEnv({ NODE_ENV: "development", DATABASE_URL: "postgresql://localhost/db", METRICS_TOKEN: weak }).length > 0);
});

test("development does not require a rate-limit backend", () => {
    assert.deepEqual(validateEnv({ NODE_ENV: "development", DATABASE_URL: "postgresql://localhost/db" }), []);
});

test("blank values count as missing", () => {
    const problems = validateEnv({ ...validProduction, DATABASE_URL: "   ", WEATHER_API_KEY: "" });

    assert.deepEqual(problems, ["Missing DATABASE_URL", "Missing WEATHER_API_KEY"]);
});

test("non-development environments never accept the dev fallback or a short secret", () => {
    for (const NODE_ENV of ["production", "test", "staging", undefined]) {
        assert.ok(validateEnv({ ...validProduction, NODE_ENV, BETTER_AUTH_SECRET: "dev-only-secret-change-me" }).length > 0);
        assert.ok(validateEnv({ ...validProduction, NODE_ENV, BETTER_AUTH_SECRET: "too-short" }).length > 0);
    }
});

test("validation messages never include secret values", () => {
    const secret = "short-secret-value";
    const problems = validateEnv({ ...validProduction, BETTER_AUTH_SECRET: secret });

    assert.ok(problems.length > 0);
    assert.ok(problems.every((problem) => !problem.includes(secret)));
});
