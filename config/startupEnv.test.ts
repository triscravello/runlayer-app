import assert from "node:assert/strict";
import test from "node:test";
import { register } from "../instrumentation";
import { EXIT_FLUSH_TIMEOUT_MS, EnvironmentConfigurationError, assertValidRuntimeEnv, describeStartupFailure, shouldValidateRuntimeEnv, terminateStartup, type StartupIo } from "./startupEnv";

const SECRET_VALUE = "a-strong-test-secret-with-more-than-32-chars";
const PASSWORD = "very-secret-db-password-sentinel";

const valid = {
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: SECRET_VALUE,
    DATABASE_URL: `postgresql://user:${PASSWORD}@db.example.test:5432/db`,
    WEATHER_API_KEY: "weather-key-sentinel",
    RATE_LIMIT_BACKEND: "memory",
    CLIENT_IP_STRATEGY: "xff-hops:1",
};

// Settings that are not secrets and may legitimately be named in a message (for example "production").
const NON_SECRET = new Set(["NODE_ENV", "NEXT_RUNTIME", "NEXT_PHASE"]);

function problemsOf(env: Record<string, string | undefined>): readonly string[] {
    try {
        assertValidRuntimeEnv(env);
    } catch (error) {
        assert.ok(error instanceof EnvironmentConfigurationError);
        // Neither the message nor the problem list may carry a configured value.
        for (const [name, value] of Object.entries(env)) {
            if (NON_SECRET.has(name) || !value || value.length <= 8) continue;
            assert.ok(!error.message.includes(value), `leaked the value of ${name}`);
        }
        return error.problems;
    }
    return [];
}

test("a complete production configuration passes", () => {
    assert.doesNotThrow(() => assertValidRuntimeEnv(valid));
    assert.deepEqual(problemsOf(valid), []);
});

test("validation applies to a running production server only", () => {
    assert.equal(shouldValidateRuntimeEnv({ NODE_ENV: "production" }), true);
    assert.equal(shouldValidateRuntimeEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-server" }), true);
    for (const env of [{}, { NODE_ENV: "development" }, { NODE_ENV: "test" }, { NODE_ENV: "staging" }, { NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }]) {
        assert.equal(shouldValidateRuntimeEnv(env), false, JSON.stringify(env));
    }
});

test("development, test and the production build need no secrets", () => {
    for (const env of [{}, { NODE_ENV: "development" }, { NODE_ENV: "test" }, { NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }]) {
        assert.doesNotThrow(() => assertValidRuntimeEnv(env), JSON.stringify(env));
    }
});

test("missing production configuration lists every problem", () => {
    const problems = problemsOf({ NODE_ENV: "production" });
    const text = problems.join("\n");
    for (const name of ["BETTER_AUTH_SECRET", "DATABASE_URL", "WEATHER_API_KEY", "RATE_LIMIT_BACKEND", "CLIENT_IP_STRATEGY"]) assert.match(text, new RegExp(name), name);
    assert.ok(problems.length >= 5);
});

test("each missing variable is reported on its own", () => {
    for (const [name, pattern] of [
        ["BETTER_AUTH_SECRET", /BETTER_AUTH_SECRET/],
        ["DATABASE_URL", /DATABASE_URL/],
        ["WEATHER_API_KEY", /WEATHER_API_KEY/],
        ["RATE_LIMIT_BACKEND", /RATE_LIMIT_BACKEND/],
        ["CLIENT_IP_STRATEGY", /CLIENT_IP_STRATEGY/],
    ] as const) {
        const problems = problemsOf({ ...valid, [name]: undefined });
        assert.equal(problems.length, 1, name);
        assert.match(problems[0], pattern);
    }
});

test("malformed production configuration is rejected without echoing values", () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
        [{ BETTER_AUTH_SECRET: "too-short-VALUE" }, /at least 32 characters/],
        [{ BETTER_AUTH_SECRET: "dev-only-secret-change-me" }, /development fallback/],
        [{ RATE_LIMIT_BACKEND: "redis-VALUE" }, /RATE_LIMIT_BACKEND/],
        [{ RATE_LIMIT_BACKEND: "upstash" }, /UPSTASH_REDIS_REST_URL/],
        [{ CLIENT_IP_STRATEGY: "bogus-strategy-VALUE" }, /CLIENT_IP_STRATEGY/],
        [{ CLIENT_IP_STRATEGY: "xff-hops:99" }, /CLIENT_IP_STRATEGY/],
        [{ METRICS_TOKEN: "short-token-VALUE" }, /METRICS_TOKEN/],
        [{ METRICS_TOKEN: `${"x".repeat(40)} with spaces` }, /METRICS_TOKEN/],
    ];
    for (const [override, pattern] of cases) {
        const problems = problemsOf({ ...valid, ...override });
        assert.ok(problems.some((problem) => pattern.test(problem)), JSON.stringify(Object.keys(override)));
    }
});

test("valid optional configuration still passes", () => {
    assert.deepEqual(problemsOf({ ...valid, RATE_LIMIT_BACKEND: "upstash", UPSTASH_REDIS_REST_URL: "https://x.example.test", UPSTASH_REDIS_REST_TOKEN: "token-sentinel", METRICS_TOKEN: "m".repeat(40) }), []);
});

test("the thrown error names problems and never the configured values", () => {
    try {
        assertValidRuntimeEnv({ ...valid, BETTER_AUTH_SECRET: "short", DATABASE_URL: undefined });
        assert.fail("expected an error");
    } catch (error) {
        assert.ok(error instanceof EnvironmentConfigurationError);
        assert.match(error.message, /^Invalid production configuration \(2 problems\):/);
        assert.ok(!error.message.includes(PASSWORD));
        assert.ok(!error.message.includes(SECRET_VALUE));
    }
});

// ---- terminateStartup --------------------------------------------------------------------------------------------------------

function fakeIo() {
    const events: string[] = [];
    let flush: () => void = () => {};
    const io: StartupIo = {
        writeError: (text, done) => {
            events.push(`write:${text}`);
            flush = done;
        },
        exit: (code) => {
            events.push(`exit:${code}`);
        },
    };
    return { io, events, flush: () => flush() };
}

const settledOrPending = (promise: Promise<unknown>) => Promise.race([promise.then(() => "settled", () => "settled"), new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 50))]);

test("terminateStartup reports the problems, then exits with status 1 only after the message is flushed", async () => {
    const { io, events, flush } = fakeIo();
    const promise = terminateStartup(new EnvironmentConfigurationError(["BETTER_AUTH_SECRET must be at least 32 characters"]), io);

    assert.equal(events.length, 1, "nothing exits before the message is flushed");
    assert.match(events[0], /^write:Invalid production configuration \(1 problem\):\n  - BETTER_AUTH_SECRET must be at least 32 characters\nThe server will not start; exiting with status 1\.\n$/);

    flush();
    assert.deepEqual(events.slice(1), ["exit:1"]);
    flush();
    assert.equal(events.filter((event) => event.startsWith("exit:")).length, 1, "exits at most once");
    assert.equal(await settledOrPending(promise), "pending", "the promise never settles, so Next cannot finish preparing");
});

test("terminateStartup still exits if the stream never reports the message as flushed", async () => {
    const { io, events } = fakeIo();
    void terminateStartup(new EnvironmentConfigurationError(["x"]), io, 25);
    assert.equal(events.filter((event) => event.startsWith("exit:")).length, 0, "not before the timeout");
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(events.filter((event) => event.startsWith("exit:")), ["exit:1"]);
    assert.ok(EXIT_FLUSH_TIMEOUT_MS >= 500 && EXIT_FLUSH_TIMEOUT_MS <= 10_000, "the default is bounded");
});

test("an unexpected error is reported by class name only, never by message", () => {
    const { io, events } = fakeIo();
    void terminateStartup(new TypeError("connection string postgresql://user:pw-sentinel@host/db"), io);
    assert.match(events[0], /Startup validation failed unexpectedly \(TypeError\)/);
    assert.ok(!events[0].includes("pw-sentinel"));
    assert.equal(describeStartupFailure("not an error"), "Startup validation failed unexpectedly (UnknownError).");
});

// ---- Next.js integration point -------------------------------------------------------------------------------------------

const mutableEnv = process.env as Record<string, string | undefined>;
const MANAGED = ["NODE_ENV", "NEXT_RUNTIME", "NEXT_PHASE", ...Object.keys(valid)];

async function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
    const saved = Object.fromEntries(MANAGED.map((name) => [name, mutableEnv[name]]));
    for (const name of MANAGED) delete mutableEnv[name];
    Object.assign(mutableEnv, values);
    try {
        await fn();
    } finally {
        for (const name of MANAGED) delete mutableEnv[name];
        for (const [name, value] of Object.entries(saved)) if (value !== undefined) mutableEnv[name] = value;
    }
}

type Captured = { stderr: string[]; exits: number[] };

/** Replaces process.exit and process.stderr.write for the duration, so a test can observe a termination without suffering it. */
async function withProcessStubs(fn: (captured: Captured) => Promise<void>) {
    const realExit = process.exit;
    const realWrite = process.stderr.write;
    const captured: Captured = { stderr: [], exits: [] };

    process.exit = ((code?: number) => {
        captured.exits.push(code ?? 0);
    }) as typeof process.exit;
    process.stderr.write = ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
        captured.stderr.push(String(chunk));
        const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
        if (typeof done === "function") (done as () => void)();
        return true;
    }) as typeof process.stderr.write;

    try {
        await fn(captured);
    } finally {
        process.exit = realExit;
        process.stderr.write = realWrite;
    }
}

const quiet = (captured: Captured) => assert.deepEqual({ exits: captured.exits, stderr: captured.stderr }, { exits: [], stderr: [] });

test("register() does nothing outside the Node.js runtime", async () => {
    await withProcessStubs(async (captured) => {
        await withEnv({ NODE_ENV: "production" }, () => assert.doesNotReject(register()));
        await withEnv({ NODE_ENV: "production", NEXT_RUNTIME: "edge" }, () => assert.doesNotReject(register()));
        quiet(captured);
    });
});

test("register() does not interfere with development or the build", async () => {
    await withProcessStubs(async (captured) => {
        await withEnv({ NEXT_RUNTIME: "nodejs", NODE_ENV: "development" }, () => assert.doesNotReject(register()));
        await withEnv({ NEXT_RUNTIME: "nodejs", NODE_ENV: "test" }, () => assert.doesNotReject(register()));
        await withEnv({ NEXT_RUNTIME: "nodejs", NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }, () => assert.doesNotReject(register()));
        quiet(captured);
    });
});

test("register() lets a valid production server start", async () => {
    await withProcessStubs(async (captured) => {
        await withEnv({ ...valid, NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-server" }, async () => {
            assert.equal(await register(), undefined);
        });
        quiet(captured);
    });
});

test("register() terminates a production Node.js server with an invalid configuration: status 1, problems named, values withheld, never resolves", async () => {
    await withProcessStubs(async (captured) => {
        await withEnv({ NEXT_RUNTIME: "nodejs", NODE_ENV: "production", BETTER_AUTH_SECRET: "short-AUTHSENTINEL", RATE_LIMIT_BACKEND: "bogus-RLSENTINEL", CLIENT_IP_STRATEGY: "bad-IPSENTINEL" }, async () => {
            assert.equal(await settledOrPending(register()), "pending", "register() must not resolve or reject: Next would swallow it and keep serving 500s");
        });

        assert.deepEqual(captured.exits, [1]);
        const text = captured.stderr.join("");
        for (const name of ["Invalid production configuration", "BETTER_AUTH_SECRET", "DATABASE_URL", "WEATHER_API_KEY", "RATE_LIMIT_BACKEND", "CLIENT_IP_STRATEGY"]) assert.match(text, new RegExp(name), name);
        for (const value of ["short-AUTHSENTINEL", "bogus-RLSENTINEL", "bad-IPSENTINEL"]) assert.ok(!text.includes(value), `leaked ${value}`);
    });
});
