import assert from "node:assert/strict";
import test from "node:test";
import {
    RateLimitConfigError,
    createRateLimiter,
    type RateLimitEvent,
    type RateLimitResult,
    type RateLimiterDeps,
    type RateLimiterOptions,
    type RemoteLimiter,
} from "./createRateLimiter";

const URL = "https://example.invalid";
const TOKEN = "placeholder-token-value";

const authOptions: RateLimiterOptions = {
    name: "auth",
    limit: 3,
    windowSeconds: 60,
    prefix: "test:auth",
    algorithm: "fixed",
    failurePolicy: "memory-fallback",
};

const globalOptions: RateLimiterOptions = { ...authOptions, name: "global", prefix: "test:global", failurePolicy: "fail-open" };

function harness(env: Record<string, string | undefined>, remoteBehavior?: (identifier: string) => Promise<RateLimitResult>, extra?: Partial<RateLimiterDeps>) {
    let current = 1_000_000;
    const events: RateLimitEvent[] = [];
    let remoteCreations = 0;
    let remoteCalls = 0;

    const deps: RateLimiterDeps = {
        env: () => env,
        now: () => current,
        report: (event) => events.push(event),
        createRemote: (): RemoteLimiter => {
            remoteCreations += 1;
            return {
                limit: async (identifier) => {
                    remoteCalls += 1;
                    if (!remoteBehavior) throw new Error("remote used unexpectedly");
                    return remoteBehavior(identifier);
                },
            };
        },
        ...extra,
    };

    return {
        deps,
        events,
        advance: (ms: number) => {
            current += ms;
        },
        counts: () => ({ remoteCreations, remoteCalls }),
    };
}

const upstashEnv = { NODE_ENV: "production", RATE_LIMIT_BACKEND: "upstash", UPSTASH_REDIS_REST_URL: URL, UPSTASH_REDIS_REST_TOKEN: TOKEN };

const remoteAllows = async (): Promise<RateLimitResult> => ({ success: true, limit: 3, remaining: 2, reset: 42, pending: Promise.resolve() });
const remoteThrows = async (): Promise<RateLimitResult> => {
    throw new Error("connect ECONNREFUSED");
};

// --- memory backend -------------------------------------------------------

test("memory backend (default outside production) enforces the limit and never touches Upstash", async () => {
    const h = harness({ NODE_ENV: "development" });
    const limiter = createRateLimiter(authOptions, h.deps);

    const results = [];
    for (let index = 0; index < 5; index += 1) results.push(await limiter.limit("client"));

    assert.deepEqual(results.map((result) => result.success), [true, true, true, false, false]);
    assert.deepEqual(h.counts(), { remoteCreations: 0, remoteCalls: 0 });
    assert.deepEqual(h.events, []);
});

test("memory backend: window expiry and separate keys", async () => {
    const h = harness({ NODE_ENV: "test" });
    const limiter = createRateLimiter({ ...authOptions, limit: 1 }, h.deps);

    assert.equal((await limiter.limit("a")).success, true);
    assert.equal((await limiter.limit("a")).success, false);
    assert.equal((await limiter.limit("b")).success, true);

    h.advance(60_000);
    assert.equal((await limiter.limit("a")).success, true);
});

test("an explicit memory backend in production works but is reported exactly once", async () => {
    const h = harness({ NODE_ENV: "production", RATE_LIMIT_BACKEND: "memory" });
    const limiter = createRateLimiter(authOptions, h.deps);

    for (let index = 0; index < 5; index += 1) await limiter.limit("client");

    assert.deepEqual(h.events, [{ type: "memory_backend_in_production", limiter: "auth" }]);
});

// --- configuration rejection ---------------------------------------------

test("a missing backend in production rejects instead of leaving requests unprotected", async () => {
    const h = harness({ NODE_ENV: "production" });
    const limiter = createRateLimiter(authOptions, h.deps);

    await assert.rejects(limiter.limit("client"), (error: unknown) => error instanceof RateLimitConfigError && /RATE_LIMIT_BACKEND/.test(error.message));
    assert.deepEqual(h.counts(), { remoteCreations: 0, remoteCalls: 0 });
});

test("upstash without credentials rejects and never silently downgrades to memory", async () => {
    const h = harness({ NODE_ENV: "production", RATE_LIMIT_BACKEND: "upstash" });
    const limiter = createRateLimiter(authOptions, h.deps);

    for (let index = 0; index < 10; index += 1) {
        await assert.rejects(limiter.limit("client"), RateLimitConfigError);
    }
    assert.deepEqual(h.events, []);
});

test("an invalid backend value rejects", async () => {
    const limiter = createRateLimiter(authOptions, harness({ NODE_ENV: "development", RATE_LIMIT_BACKEND: "off" }).deps);

    await assert.rejects(limiter.limit("client"), RateLimitConfigError);
});

// --- upstash backend ------------------------------------------------------

test("upstash backend passes the remote result through and creates the client once", async () => {
    const h = harness(upstashEnv, remoteAllows);
    const limiter = createRateLimiter(authOptions, h.deps);

    const first = await limiter.limit("client");
    await limiter.limit("client");

    assert.equal(first.success, true);
    assert.equal(first.reset, 42);
    assert.deepEqual(h.counts(), { remoteCreations: 1, remoteCalls: 2 });
    assert.deepEqual(h.events, []);
});

test("an Upstash outage on an auth limiter falls back to a bounded memory limiter and is reported", async () => {
    const h = harness(upstashEnv, remoteThrows);
    const limiter = createRateLimiter(authOptions, h.deps);

    const results = [];
    for (let index = 0; index < 5; index += 1) results.push(await limiter.limit("client"));

    assert.deepEqual(results.map((result) => result.success), [true, true, true, false, false], "login protection stays active");
    assert.equal(h.events.length, 5, "every degraded decision is reported");
    assert.ok(h.events.every((event) => event.type === "remote_error" && event.policy === "memory-fallback" && event.limiter === "auth"));
});

test("memory fallback: window expiry and separate keys during an outage", async () => {
    const h = harness(upstashEnv, remoteThrows);
    const limiter = createRateLimiter({ ...authOptions, limit: 1 }, h.deps);

    assert.equal((await limiter.limit("a")).success, true);
    assert.equal((await limiter.limit("a")).success, false);
    assert.equal((await limiter.limit("b")).success, true);

    h.advance(60_000);
    assert.equal((await limiter.limit("a")).success, true);
});

test("memory fallback state is bounded and evictions are reported", async () => {
    const h = harness(upstashEnv, remoteThrows, { memoryMaxKeys: 5 });
    const limiter = createRateLimiter(authOptions, h.deps);

    for (let index = 0; index < 50; index += 1) await limiter.limit(`key-${index}`);

    const evictions = h.events.filter((event) => event.type === "memory_eviction");
    assert.equal(evictions.length, 45, "50 unique keys into a 5-key table evict 45 entries");
});

test("a fail-open limiter allows requests during an outage and reports every one", async () => {
    const h = harness(upstashEnv, remoteThrows);
    const limiter = createRateLimiter(globalOptions, h.deps);

    const results = [];
    for (let index = 0; index < 10; index += 1) results.push(await limiter.limit("client"));

    assert.ok(results.every((result) => result.success), "documented behavior: non-auth limiters fail open");
    assert.equal(h.events.length, 10);
    assert.ok(h.events.every((event) => event.type === "remote_error" && event.policy === "fail-open"));
});

test("the limiter recovers to Upstash as soon as it responds again", async () => {
    let healthy = false;
    const h = harness(upstashEnv, async (identifier) => (healthy ? remoteAllows() : remoteThrows().then(() => remoteAllows())).then((result) => ({ ...result, reset: identifier.length })));
    const limiter = createRateLimiter(authOptions, h.deps);

    const during = await limiter.limit("client");
    healthy = true;
    const after = await limiter.limit("client");

    assert.equal(during.success, true);
    assert.equal(after.reset, "client".length, "the second decision came from Upstash");
    assert.equal(h.events.length, 1);
});

test("a failure while creating the remote client is treated as an outage and retried", async () => {
    let attempts = 0;
    const h = harness(upstashEnv, remoteAllows, {
        createRemote: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("invalid url");
            return { limit: remoteAllows };
        },
    });
    const limiter = createRateLimiter(authOptions, h.deps);

    assert.equal((await limiter.limit("client")).success, true);
    assert.equal(h.events.length, 1);

    const second = await limiter.limit("client");
    assert.equal(second.reset, 42, "second call used the recovered remote client");
    assert.equal(attempts, 2);
});

test("reported errors never contain the Upstash URL or token", async () => {
    const h = harness(upstashEnv, async () => {
        throw new Error(`request to ${URL}/pipeline failed with token ${TOKEN}`);
    });
    const limiter = createRateLimiter(authOptions, h.deps);

    await limiter.limit("client");

    const event = h.events[0];
    assert.equal(event.type, "remote_error");
    const error = event.type === "remote_error" ? event.error : "";
    assert.ok(!error.includes(TOKEN));
    assert.ok(!error.includes(URL));
    assert.match(error, /\[redacted\]/);
});

test("reported errors are length-bounded", async () => {
    const h = harness(upstashEnv, async () => {
        throw new Error("x".repeat(10_000));
    });
    await createRateLimiter(authOptions, h.deps).limit("client");

    const event = h.events[0];
    assert.ok(event.type === "remote_error" && event.error.length <= 200);
});
