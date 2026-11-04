import assert from "node:assert/strict";
import test from "node:test";
import { UNKNOWN_CLIENT_IP, resolveClientIpFromEnv } from "../http/clientIp";
import {
    AUTH_RATE_LIMITS,
    buildRateLimitedResponse,
    checkEmailLimit,
    checkNetworkLimits,
    createAuthLimiters,
    emailRateLimitKey,
    mostRestrictive,
    normalizeEmailForRateLimit,
    type AuthLimiters,
} from "./authThrottle";
import type { RateLimitEvent, RateLimitResult, RateLimiterDeps, SafeRateLimiter } from "./createRateLimiter";
import { DEFAULT_MEMORY_MAX_KEYS } from "./memoryLimiter";

const SECRET = "test-secret-with-more-than-32-characters!";
const OTHER_SECRET = "a-different-test-secret-with-32-plus-chars";

function setup(options: { env?: Record<string, string | undefined>; createRemote?: RateLimiterDeps["createRemote"]; memoryMaxKeys?: number } = {}) {
    let current = 1_000_000;
    const events: RateLimitEvent[] = [];

    const deps: RateLimiterDeps = {
        env: () => options.env ?? { NODE_ENV: "test" },
        now: () => current,
        report: (event) => events.push(event),
        createRemote:
            options.createRemote ??
            (() => {
                throw new Error("the distributed backend must not be used");
            }),
        memoryMaxKeys: options.memoryMaxKeys,
    };

    return {
        limiters: createAuthLimiters(deps),
        events,
        advance: (ms: number) => {
            current += ms;
        },
        now: () => current,
    };
}

type Outcome = "ok" | "network" | "email";

// Mirrors the layering the login route applies.
async function loginAttempt(limiters: AuthLimiters, ip: string, email: string): Promise<Outcome> {
    const network = await checkNetworkLimits({ flood: limiters.loginFlood, ip: limiters.loginIp }, ip);
    if (!network.allowed) return "network";

    const account = await checkEmailLimit(limiters.loginEmail, emailRateLimitKey(email, SECRET));
    return account.allowed ? "ok" : "email";
}

// Mirrors the layering the signup route applies.
async function signupAttempt(limiters: AuthLimiters, ip: string, email: string): Promise<Outcome> {
    const network = await checkNetworkLimits({ flood: limiters.signupFlood, ip: limiters.signupIp }, ip);
    if (!network.allowed) return "network";

    const account = await checkEmailLimit(limiters.signupEmail, emailRateLimitKey(email, SECRET));
    return account.allowed ? "ok" : "email";
}

async function runAttempts(count: number, attempt: (index: number) => Promise<Outcome>) {
    const outcomes: Outcome[] = [];
    for (let index = 0; index < count; index += 1) outcomes.push(await attempt(index));
    return outcomes;
}

// --- email normalization and hashing -------------------------------------

test("email normalization matches the login lookup and variants share one key", () => {
    assert.equal(normalizeEmailForRateLimit("  Alice@Example.COM "), "alice@example.com");

    const keys = new Set(["Alice@Example.com", "  alice@example.com ", "ALICE@EXAMPLE.COM"].map((email) => emailRateLimitKey(email, SECRET)));
    assert.equal(keys.size, 1);
});

test("different emails and different secrets produce different keys", () => {
    assert.notEqual(emailRateLimitKey("alice@example.com", SECRET), emailRateLimitKey("bob@example.com", SECRET));
    assert.notEqual(emailRateLimitKey("alice@example.com", SECRET), emailRateLimitKey("alice@example.com", OTHER_SECRET));
});

test("the limiter key is a keyed hash and never contains the plaintext email", () => {
    const key = emailRateLimitKey("alice@example.com", SECRET);

    assert.match(key, /^[0-9a-f]{64}$/);
    assert.ok(!key.includes("alice"));
    assert.ok(!key.includes("@"));
    assert.ok(!key.includes("example"));
});

test("very long emails produce a bounded, deterministic key", () => {
    const huge = `${"a".repeat(2_000_000)}@example.com`;
    const key = emailRateLimitKey(huge, SECRET);

    assert.match(key, /^[0-9a-f]{64}$/);
    assert.equal(key, emailRateLimitKey(huge, SECRET));
});

// --- login: per-account limit --------------------------------------------

test("repeated attempts against the same email are limited, and other emails are independent", async () => {
    const { limiters } = setup();
    const limit = AUTH_RATE_LIMITS.loginEmail.limit;

    const victim = await runAttempts(limit + 3, () => loginAttempt(limiters, UNKNOWN_CLIENT_IP, "victim@example.com"));
    assert.deepEqual(victim, [...Array<Outcome>(limit).fill("ok"), "email", "email", "email"]);

    assert.equal(await loginAttempt(limiters, UNKNOWN_CLIENT_IP, "someone-else@example.com"), "ok");
});

test("case and whitespace variants of an email share one account limit", async () => {
    const { limiters } = setup();
    const variants = ["Victim@Example.com", " victim@example.com", "VICTIM@EXAMPLE.COM "];

    const outcomes = await runAttempts(AUTH_RATE_LIMITS.loginEmail.limit + 1, (index) => loginAttempt(limiters, UNKNOWN_CLIENT_IP, variants[index % variants.length]));

    assert.equal(outcomes.at(-1), "email");
});

test("an account lockout is temporary: it expires with the window and denied attempts never extend it", async () => {
    const { limiters, advance } = setup();
    const { limit, windowSeconds } = AUTH_RATE_LIMITS.loginEmail;

    await runAttempts(limit, () => loginAttempt(limiters, UNKNOWN_CLIENT_IP, "victim@example.com"));

    // An attacker keeps hammering the account at these offsets (seconds) after the window opened.
    let elapsed = 0;
    for (const offset of [60, 300, 600, windowSeconds - 1]) {
        advance((offset - elapsed) * 1000);
        elapsed = offset;
        assert.equal(await loginAttempt(limiters, UNKNOWN_CLIENT_IP, "victim@example.com"), "email", `still limited at +${offset}s`);
    }

    // The denied attempts above did not extend the window: it ends exactly windowSeconds after it opened.
    advance((windowSeconds - elapsed) * 1000);
    assert.equal(await loginAttempt(limiters, UNKNOWN_CLIENT_IP, "victim@example.com"), "ok", "the legitimate user can sign in again");
});

// --- login: IP layers -----------------------------------------------------

test("with a trusted IP, the per-IP limit applies across different emails and recovers after the window", async () => {
    const { limiters, advance } = setup();
    const limit = AUTH_RATE_LIMITS.loginIp.limit;

    const outcomes = await runAttempts(limit + 2, (index) => loginAttempt(limiters, "203.0.113.7", `user-${index}@example.com`));
    assert.deepEqual(outcomes, [...Array<Outcome>(limit).fill("ok"), "network", "network"]);

    assert.equal(await loginAttempt(limiters, "203.0.113.8", "other@example.com"), "ok", "other IPs are independent");

    advance(AUTH_RATE_LIMITS.loginIp.windowSeconds * 1000);
    assert.equal(await loginAttempt(limiters, "203.0.113.7", "again@example.com"), "ok");
});

test("with no trusted IP the per-IP limiter is never consulted, so users cannot lock each other out", async () => {
    const { limiters } = setup();
    const forbiddenIpLimiter: SafeRateLimiter = {
        limit: async () => {
            throw new Error("the per-IP limiter must not be used without a trusted IP");
        },
    };

    // Far more attempts than the per-IP limit, from "everyone", with different accounts.
    for (let index = 0; index < 20; index += 1) {
        const network = await checkNetworkLimits({ flood: limiters.loginFlood, ip: forbiddenIpLimiter }, UNKNOWN_CLIENT_IP);
        assert.equal(network.allowed, true);
    }
});

// --- login: flood guard ---------------------------------------------------

test("the global flood guard bounds total attempts and recovers after its window", async () => {
    const { limiters, advance } = setup();
    const { limit, windowSeconds } = AUTH_RATE_LIMITS.loginFlood;

    const outcomes = await runAttempts(limit + 2, (index) => loginAttempt(limiters, UNKNOWN_CLIENT_IP, `bot-${index}@example.com`));
    assert.equal(outcomes.filter((outcome) => outcome === "ok").length, limit);
    assert.deepEqual(outcomes.slice(-2), ["network", "network"]);

    advance(windowSeconds * 1000);
    assert.equal(await loginAttempt(limiters, UNKNOWN_CLIENT_IP, "real-user@example.com"), "ok");
});

test("requests rejected by the flood guard do not consume an account's budget", async () => {
    const { limiters, advance } = setup();
    const { limit, windowSeconds } = AUTH_RATE_LIMITS.loginFlood;

    await runAttempts(limit, (index) => loginAttempt(limiters, UNKNOWN_CLIENT_IP, `bot-${index}@example.com`));

    const blocked = await runAttempts(AUTH_RATE_LIMITS.loginEmail.limit + 5, () => loginAttempt(limiters, UNKNOWN_CLIENT_IP, "victim@example.com"));
    assert.ok(blocked.every((outcome) => outcome === "network"));

    advance(windowSeconds * 1000);
    const afterwards = await runAttempts(AUTH_RATE_LIMITS.loginEmail.limit, () => loginAttempt(limiters, UNKNOWN_CLIENT_IP, "victim@example.com"));
    assert.ok(afterwards.every((outcome) => outcome === "ok"), "the victim still has the full account budget");
});

// --- spoofed forwarding headers -------------------------------------------

test("rotating X-Forwarded-For cannot reset the account limit (strategy none)", async () => {
    const { limiters } = setup();
    const env = { NODE_ENV: "production", CLIENT_IP_STRATEGY: "none" };

    const outcomes = await runAttempts(AUTH_RATE_LIMITS.loginEmail.limit + 5, (index) => {
        const headers = new Headers({ "x-forwarded-for": `198.51.100.${index}`, "x-real-ip": `198.51.100.${index}` });
        return loginAttempt(limiters, resolveClientIpFromEnv(headers, env), "victim@example.com");
    });

    assert.equal(outcomes.filter((outcome) => outcome === "ok").length, AUTH_RATE_LIMITS.loginEmail.limit);
    assert.equal(outcomes.at(-1), "email");
});

test("rotating the client-controlled side of X-Forwarded-For cannot reset the IP limit (xff-hops:1)", async () => {
    const { limiters } = setup();
    const env = { NODE_ENV: "production", CLIENT_IP_STRATEGY: "xff-hops:1" };

    const outcomes = await runAttempts(AUTH_RATE_LIMITS.loginIp.limit + 3, (index) => {
        const headers = new Headers({ "x-forwarded-for": `198.51.100.${index}, 203.0.113.50` });
        return loginAttempt(limiters, resolveClientIpFromEnv(headers, env), `user-${index}@example.com`);
    });

    assert.deepEqual(outcomes.slice(-3), ["network", "network", "network"]);
});

// --- signup ---------------------------------------------------------------

test("signup is limited per email, independently of login", async () => {
    const { limiters } = setup();
    const limit = AUTH_RATE_LIMITS.signupEmail.limit;

    const outcomes = await runAttempts(limit + 2, () => signupAttempt(limiters, UNKNOWN_CLIENT_IP, "new@example.com"));
    assert.deepEqual(outcomes, [...Array<Outcome>(limit).fill("ok"), "email", "email"]);

    assert.equal(await loginAttempt(limiters, UNKNOWN_CLIENT_IP, "new@example.com"), "ok", "login budget is separate");
});

test("signup abuse from one trusted IP is limited across many emails", async () => {
    const { limiters, advance } = setup();
    const limit = AUTH_RATE_LIMITS.signupIp.limit;

    const outcomes = await runAttempts(limit + 3, (index) => signupAttempt(limiters, "203.0.113.9", `bot-${index}@example.com`));
    assert.deepEqual(outcomes, [...Array<Outcome>(limit).fill("ok"), "network", "network", "network"]);

    assert.equal(await signupAttempt(limiters, "203.0.113.10", "human@example.com"), "ok");

    advance(AUTH_RATE_LIMITS.signupIp.windowSeconds * 1000);
    assert.equal(await signupAttempt(limiters, "203.0.113.9", "back@example.com"), "ok");
});

test("signup abuse with no trusted IP is bounded by the global signup flood guard", async () => {
    const { limiters, advance } = setup();
    const { limit, windowSeconds } = AUTH_RATE_LIMITS.signupFlood;

    const outcomes = await runAttempts(limit + 5, (index) => signupAttempt(limiters, UNKNOWN_CLIENT_IP, `bot-${index}@example.com`));
    assert.equal(outcomes.filter((outcome) => outcome === "ok").length, limit);

    advance(windowSeconds * 1000);
    assert.equal(await signupAttempt(limiters, UNKNOWN_CLIENT_IP, "real@example.com"), "ok");
});

test("a signup flood does not consume the login flood guard", async () => {
    const { limiters } = setup();

    await runAttempts(AUTH_RATE_LIMITS.signupFlood.limit + 5, (index) => signupAttempt(limiters, UNKNOWN_CLIENT_IP, `bot-${index}@example.com`));

    assert.equal(await loginAttempt(limiters, UNKNOWN_CLIENT_IP, "user@example.com"), "ok");
});

// --- backend failures -----------------------------------------------------

test("when the distributed backend fails, every authentication limit is still enforced and reported", async () => {
    const { limiters, events } = setup({
        env: { NODE_ENV: "production", RATE_LIMIT_BACKEND: "upstash", UPSTASH_REDIS_REST_URL: "https://example.invalid", UPSTASH_REDIS_REST_TOKEN: "placeholder-token-value" },
        createRemote: () => ({
            limit: async () => {
                throw new Error("connect ECONNREFUSED");
            },
        }),
    });

    const account = await runAttempts(AUTH_RATE_LIMITS.loginEmail.limit + 2, () => loginAttempt(limiters, UNKNOWN_CLIENT_IP, "victim@example.com"));
    assert.equal(account.filter((outcome) => outcome === "ok").length, AUTH_RATE_LIMITS.loginEmail.limit);
    assert.equal(account.at(-1), "email");

    const perIp = await runAttempts(AUTH_RATE_LIMITS.loginIp.limit + 1, (index) => loginAttempt(limiters, "203.0.113.7", `user-${index}@example.com`));
    assert.equal(perIp.at(-1), "network");

    const signup = await runAttempts(AUTH_RATE_LIMITS.signupEmail.limit + 1, () => signupAttempt(limiters, UNKNOWN_CLIENT_IP, "new@example.com"));
    assert.equal(signup.at(-1), "email");

    assert.ok(events.length > 0);
    assert.ok(events.every((event) => event.type === "remote_error" && event.policy === "memory-fallback"));
    const limiterNames = new Set(events.map((event) => event.limiter));
    assert.ok(limiterNames.has("login_email") && limiterNames.has("login_flood") && limiterNames.has("auth") && limiterNames.has("signup_email"));
});

test("reported events never contain a plaintext email address or an IP", async () => {
    const { limiters, events } = setup({
        env: { NODE_ENV: "production", RATE_LIMIT_BACKEND: "upstash", UPSTASH_REDIS_REST_URL: "https://example.invalid", UPSTASH_REDIS_REST_TOKEN: "placeholder-token-value" },
        createRemote: () => ({
            limit: async () => {
                throw new Error("connect ECONNREFUSED");
            },
        }),
    });

    await loginAttempt(limiters, "203.0.113.77", "private.person@example.com");

    const serialized = JSON.stringify(events);
    assert.ok(events.length > 0);
    assert.ok(!serialized.includes("private.person"));
    assert.ok(!serialized.includes("203.0.113.77"));
});

// --- bounded state ---------------------------------------------------------

test("the configured limits keep unique-email floods below the memory table cap", () => {
    const loginKeysPerWindow = AUTH_RATE_LIMITS.loginFlood.limit * Math.ceil(AUTH_RATE_LIMITS.loginEmail.windowSeconds / AUTH_RATE_LIMITS.loginFlood.windowSeconds);
    const signupKeysPerWindow = AUTH_RATE_LIMITS.signupFlood.limit * Math.ceil(AUTH_RATE_LIMITS.signupEmail.windowSeconds / AUTH_RATE_LIMITS.signupFlood.windowSeconds);

    assert.ok(loginKeysPerWindow < DEFAULT_MEMORY_MAX_KEYS, `${loginKeysPerWindow} login keys per window`);
    assert.ok(signupKeysPerWindow < DEFAULT_MEMORY_MAX_KEYS, `${signupKeysPerWindow} signup keys per window`);
});

test("a flood of random emails cannot evict a targeted account's counter", async () => {
    const { limiters, events, advance } = setup();
    const { windowSeconds } = AUTH_RATE_LIMITS.loginEmail;

    let victimAllowed = 0;
    let victimEmailDenied = 0;

    for (let second = 0; second < windowSeconds; second += 1) {
        // At the start of every minute the attacker tries the victim, then saturates the flood guard with random emails.
        if (second % 60 === 0) {
            const outcome = await loginAttempt(limiters, UNKNOWN_CLIENT_IP, "victim@example.com");
            if (outcome === "ok") victimAllowed += 1;
            if (outcome === "email") victimEmailDenied += 1;
        }

        await loginAttempt(limiters, UNKNOWN_CLIENT_IP, `random-${second}@example.com`);
        advance(1_000);
    }

    assert.equal(events.filter((event) => event.type === "memory_eviction").length, 0, "no entry was evicted");
    assert.equal(victimAllowed, AUTH_RATE_LIMITS.loginEmail.limit);
    assert.ok(victimEmailDenied > 0, "the account limit stayed in force");
});

test("without enough capacity the table stays bounded and evictions are reported", async () => {
    const { limiters, events } = setup({ memoryMaxKeys: 5 });

    for (let index = 0; index < 40; index += 1) {
        await checkEmailLimit(limiters.loginEmail, emailRateLimitKey(`user-${index}@example.com`, SECRET));
    }

    assert.equal(events.filter((event) => event.type === "memory_eviction").length, 35);
});

// --- uniform responses and enumeration resistance -------------------------

test("every denial layer produces the same response shape and headers", () => {
    const now = 5_000_000;
    const deny = (limit: number, resetInMs: number): RateLimitResult => ({ success: false, limit, remaining: 0, reset: now + resetInMs, pending: Promise.resolve() });
    const copy = { error: "Too many login attempts", message: "Please wait before trying again." };

    const flood = buildRateLimitedResponse(deny(60, 20_000), now, copy);
    const ip = buildRateLimitedResponse(deny(5, 20_000), now, copy);
    const account = buildRateLimitedResponse(deny(10, 20_000), now, copy);

    for (const response of [flood, ip, account]) {
        assert.equal(response.status, 429);
        assert.deepEqual(Object.keys(response.body), ["error", "message", "retryAfter"]);
        assert.equal(response.body.error, copy.error);
        assert.equal(response.body.message, copy.message);
        assert.equal(response.body.retryAfter, 20);
        assert.equal(response.headers["Retry-After"], "20");
        assert.equal(response.headers["X-RateLimit-Remaining"], "0");
        assert.deepEqual(Object.keys(response.headers).sort(), ["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]);
    }
});

test("retryAfter is never negative", () => {
    const stale: RateLimitResult = { success: false, limit: 5, remaining: 0, reset: 1_000, pending: Promise.resolve() };

    assert.equal(buildRateLimitedResponse(stale, 9_000, { error: "e", message: "m" }).body.retryAfter, 0);
});

test("throttling decisions are identical for registered and unregistered addresses", async () => {
    // The throttle never consults the user table, so an existing and a non-existent address cannot be told apart.
    const registered = setup();
    const unregistered = setup();
    const count = AUTH_RATE_LIMITS.loginEmail.limit + 4;

    const known = await runAttempts(count, () => loginAttempt(registered.limiters, UNKNOWN_CLIENT_IP, "registered@example.com"));
    const unknown = await runAttempts(count, () => loginAttempt(unregistered.limiters, UNKNOWN_CLIENT_IP, "does-not-exist@example.com"));

    assert.deepEqual(known, unknown);
});

test("the most restrictive result is the one reported on success", () => {
    const result = (remaining: number): RateLimitResult => ({ success: true, limit: 10, remaining, reset: 1, pending: Promise.resolve() });

    assert.equal(mostRestrictive(result(5), result(2)).remaining, 2);
    assert.equal(mostRestrictive(result(2), result(5)).remaining, 2);
    assert.equal(mostRestrictive(result(3), result(3)).remaining, 3);
});
