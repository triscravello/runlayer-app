import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { HttpError } from "../http/apiErrors";
import type { RateLimitEvent, RateLimiterDeps, SafeRateLimiter } from "../rateLimit/createRateLimiter";
import {
    MAX_WEATHER_LOCATION_LENGTH,
    WEATHER_RATE_LIMIT,
    createWeatherLimiter,
    handleWeatherRequest,
    normalizeWeatherLocation,
    parseWeatherLocation,
} from "./weatherRequest";

const SAMPLE_WEATHER = {
    location: "Tampa",
    tempF: 78,
    feelsLikeF: 80,
    humidity: 70,
    windSpeed: 8,
    precipitationChance: 0.1,
    uvIndex: 0,
    condition: "Clear",
    tempCategory: "warm",
};

function setup(options: { env?: Record<string, string | undefined>; createRemote?: RateLimiterDeps["createRemote"]; limiter?: SafeRateLimiter } = {}) {
    let current = 1_000_000;
    const events: RateLimitEvent[] = [];
    const providerCalls: string[] = [];
    const rateLimitedCalls: number[] = [];

    const deps: RateLimiterDeps = {
        env: () => options.env ?? { NODE_ENV: "test" },
        now: () => current,
        report: (event) => events.push(event),
        createRemote:
            options.createRemote ??
            (() => {
                throw new Error("the distributed backend must not be used");
            }),
    };

    const limiter = options.limiter ?? createWeatherLimiter(deps);

    const get = (userId: string, location: string | null, headers: Record<string, string> = {}) => {
        const url = new URL("http://localhost/api/weather");
        if (location !== null) url.searchParams.set("location", location);

        return handleWeatherRequest(new Request(url, { headers }), {
            userId,
            limiter,
            getWeather: async (normalized) => {
                providerCalls.push(normalized);
                return SAMPLE_WEATHER;
            },
            onRateLimited: () => rateLimitedCalls.push(current),
            now: () => current,
        });
    };

    return { get, providerCalls, rateLimitedCalls, events, advance: (ms: number) => { current += ms; } };
}

function silenceConsoleError(t: TestContext) {
    t.mock.method(console, "error", () => {});
}

// --- configuration ----------------------------------------------------------

test("the per-user weather limit starts at 30 requests per minute", () => {
    assert.deepEqual({ ...WEATHER_RATE_LIMIT }, { limit: 30, windowSeconds: 60 });
});

// --- authenticated requests and response preservation -----------------------

test("an authenticated request with a valid location returns the weather unchanged", async () => {
    const { get, providerCalls } = setup();
    const response = await get("user-1", "Tampa, FL");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), SAMPLE_WEATHER, "the response body is exactly the provider result");
    assert.deepEqual(providerCalls, ["Tampa, FL"]);
    assert.equal(response.headers.get("x-ratelimit-limit"), "30");
    assert.equal(response.headers.get("x-ratelimit-remaining"), "29");
});

// --- unauthenticated requests -----------------------------------------------

test("the route is only reachable through withAuth and never calls the provider directly", () => {
    const source = readFileSync(new URL("../../app/api/weather/route.ts", import.meta.url), "utf8");

    assert.match(source, /export const GET = withAuth\(/, "GET is wrapped in withAuth, which rejects anonymous callers with 401");
    assert.doesNotMatch(source, /export (async )?function GET/, "there is no unauthenticated GET export");
    assert.doesNotMatch(source, /weatherClient/, "the route does not call the provider client directly");
    assert.match(source, /userId: user\.id/, "the limiter key comes from the authenticated session user");
});

// --- location validation ----------------------------------------------------

test("missing, empty and whitespace-only locations are rejected before the provider or limiter are used", async () => {
    const { get, providerCalls } = setup();

    for (const location of [null, "", "   ", "   "]) {
        const response = await get("user-1", location);
        assert.equal(response.status, 400, JSON.stringify(location));
        assert.deepEqual(await response.json(), { error: "Missing location", code: "BAD REQUEST" });
    }

    assert.equal(providerCalls.length, 0);
});

test("malformed locations are rejected without echoing the input", async () => {
    const { get, providerCalls } = setup();
    const malformed = [
        "<script>alert(1)</script>",
        "Tampa; DROP TABLE users",
        "a=b&appid=stolen",
        "../../etc/passwd",
        "http://evil.example/?x=1",
        "Tampa\nFL",
        "Tampa\tFL",
        "Tampa\u0000",
        "Tampa\u007f",
        "Tampa \u{1F600}",
        "100% sure",
        "{{7*7}}",
        "Tampa|FL",
        ",,,",
        "...",
        "-",
        "()",
    ];

    for (const location of malformed) {
        const response = await get("user-1", location);
        const body = await response.json();

        assert.equal(response.status, 400, JSON.stringify(location));
        assert.equal(body.error, "Location contains invalid characters");
        assert.ok(!JSON.stringify(body).includes("script"), "input is never echoed");
    }

    assert.equal(providerCalls.length, 0);
});

test("legitimate place names are accepted", async () => {
    const { get, providerCalls } = setup();
    const places = ["Tampa, FL", "St. John's, NL", "Winston-Salem, NC", "San José", "Zürich, CH", "München", "東京", "Montréal (QC)", "New York, NY 10001", "10001", "O’Fallon, MO"];

    for (const place of places) {
        assert.equal((await get("user-1", place)).status, 200, place);
    }

    assert.equal(providerCalls.length, places.length);
});

test("location length boundaries: 120 characters is accepted, 121 is rejected", async () => {
    const { get, providerCalls } = setup();
    const atLimit = "a".repeat(MAX_WEATHER_LOCATION_LENGTH);

    assert.equal((await get("user-1", atLimit)).status, 200);
    assert.equal((await get("user-1", `   ${atLimit}   `)).status, 200, "surrounding whitespace does not count");

    const over = await get("user-1", "a".repeat(MAX_WEATHER_LOCATION_LENGTH + 1));
    assert.equal(over.status, 400);
    assert.deepEqual(await over.json(), { error: "Location is too long", code: "BAD REQUEST" });

    const huge = await get("user-1", "a".repeat(100_000));
    assert.equal(huge.status, 400);

    assert.equal(providerCalls.length, 2);
});

test("locations are normalized before they reach the provider", async () => {
    const { get, providerCalls } = setup();

    for (const variant of ["Tampa, FL", "  Tampa,FL  ", "Tampa ,  FL", "Tampa , FL", "Tampa,   FL,"]) {
        await get("user-1", variant);
    }

    assert.deepEqual(providerCalls, ["Tampa, FL", "Tampa, FL", "Tampa, FL", "Tampa, FL", "Tampa, FL"]);
    assert.equal(normalizeWeatherLocation("Zürich"), "Zürich", "Unicode is normalized to NFC");
    assert.equal(parseWeatherLocation("  Zürich  "), "Zürich");
});

test("rejected (invalid) requests do not consume the user's rate-limit budget", async () => {
    const { get, providerCalls } = setup();

    for (let index = 0; index < WEATHER_RATE_LIMIT.limit + 10; index += 1) {
        assert.equal((await get("user-1", "<bad>")).status, 400);
    }

    for (let index = 0; index < WEATHER_RATE_LIMIT.limit; index += 1) {
        assert.equal((await get("user-1", "Tampa")).status, 200);
    }

    assert.equal(providerCalls.length, WEATHER_RATE_LIMIT.limit);
});

// --- per-user rate limiting --------------------------------------------------

test("a user is limited after 30 requests, the response follows the 429 convention, and the provider is not called", async () => {
    const { get, providerCalls, rateLimitedCalls } = setup();

    for (let index = 0; index < WEATHER_RATE_LIMIT.limit; index += 1) {
        assert.equal((await get("user-1", "Tampa")).status, 200);
    }

    const denied = await get("user-1", "Tampa");
    const body = await denied.json();

    assert.equal(denied.status, 429);
    assert.deepEqual(Object.keys(body), ["error", "message", "retryAfter"]);
    assert.equal(body.error, "Too many weather requests");
    assert.equal(body.retryAfter, 60);
    assert.equal(denied.headers.get("retry-after"), "60");
    assert.equal(denied.headers.get("x-ratelimit-remaining"), "0");
    assert.equal(providerCalls.length, WEATHER_RATE_LIMIT.limit, "the 31st request never reached the provider");
    assert.equal(rateLimitedCalls.length, 1, "the denial is recorded");
});

test("users are isolated from each other", async () => {
    const { get, providerCalls } = setup();

    for (let index = 0; index < WEATHER_RATE_LIMIT.limit; index += 1) await get("user-1", "Tampa");
    assert.equal((await get("user-1", "Tampa")).status, 429);

    assert.equal((await get("user-2", "Tampa")).status, 200, "another user is unaffected");
    assert.equal(providerCalls.length, WEATHER_RATE_LIMIT.limit + 1);
});

test("the limit recovers after the window", async () => {
    const { get, advance } = setup();

    for (let index = 0; index < WEATHER_RATE_LIMIT.limit; index += 1) await get("user-1", "Tampa");
    assert.equal((await get("user-1", "Tampa")).status, 429);

    advance(WEATHER_RATE_LIMIT.windowSeconds * 1000);
    assert.equal((await get("user-1", "Tampa")).status, 200);
});

test("spoofed forwarding headers can neither bypass nor trigger the per-user limit", async () => {
    const { get, providerCalls } = setup();

    for (let index = 0; index < WEATHER_RATE_LIMIT.limit; index += 1) {
        const response = await get("user-1", "Tampa", { "x-forwarded-for": `198.51.100.${index}`, "x-real-ip": `198.51.100.${index}`, forwarded: `for=198.51.100.${index}` });
        assert.equal(response.status, 200);
    }

    const denied = await get("user-1", "Tampa", { "x-forwarded-for": "203.0.113.250", "x-real-ip": "203.0.113.250" });
    assert.equal(denied.status, 429, "a fresh forwarded address does not give a fresh bucket");

    const other = await get("user-2", "Tampa", { "x-forwarded-for": "198.51.100.0" });
    assert.equal(other.status, 200, "sharing a forwarded address with another user does not count against this user");
    assert.equal(providerCalls.length, WEATHER_RATE_LIMIT.limit + 1);
});

test("the limiter key is the authenticated user id only, never the location or request headers", async () => {
    const identifiers: string[] = [];
    const spy: SafeRateLimiter = {
        limit: async (identifier) => {
            identifiers.push(identifier);
            return { success: true, limit: 30, remaining: 29, reset: 1, pending: Promise.resolve() };
        },
    };
    const { get } = setup({ limiter: spy });

    await get("5f8d0d55-0000-4000-8000-000000000001", "Tampa, FL", { "x-forwarded-for": "198.51.100.1" });
    await get("5f8d0d55-0000-4000-8000-000000000001", "Orlando, FL");

    assert.deepEqual(identifiers, ["5f8d0d55-0000-4000-8000-000000000001", "5f8d0d55-0000-4000-8000-000000000001"]);
});

// --- backend failures --------------------------------------------------------

test("when the distributed backend fails, the per-user limit is still enforced and the outage is reported", async () => {
    const { get, providerCalls, events } = setup({
        env: { NODE_ENV: "production", RATE_LIMIT_BACKEND: "upstash", UPSTASH_REDIS_REST_URL: "https://example.invalid", UPSTASH_REDIS_REST_TOKEN: "placeholder-token-value" },
        createRemote: () => ({
            limit: async () => {
                throw new Error("connect ECONNREFUSED");
            },
        }),
    });

    for (let index = 0; index < WEATHER_RATE_LIMIT.limit; index += 1) {
        assert.equal((await get("user-1", "Tampa")).status, 200);
    }

    assert.equal((await get("user-1", "Tampa")).status, 429, "weather-provider quota stays protected during the outage");
    assert.equal((await get("user-2", "Tampa")).status, 200, "weather stays available to other users");
    assert.equal(providerCalls.length, WEATHER_RATE_LIMIT.limit + 1);

    assert.ok(events.length > 0);
    assert.ok(events.every((event) => event.type === "remote_error" && event.policy === "memory-fallback" && event.limiter === "weather"));
});

test("an invalid rate-limit configuration fails the request without calling the provider", async (t) => {
    silenceConsoleError(t);
    const { get, providerCalls } = setup({ env: { NODE_ENV: "production" } });

    const response = await get("user-1", "Tampa");

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Failed to fetch weather" });
    assert.equal(providerCalls.length, 0);
});

test("reported events contain no user id and no location", async () => {
    const { get, events } = setup({
        env: { NODE_ENV: "production", RATE_LIMIT_BACKEND: "upstash", UPSTASH_REDIS_REST_URL: "https://example.invalid", UPSTASH_REDIS_REST_TOKEN: "placeholder-token-value" },
        createRemote: () => ({
            limit: async () => {
                throw new Error("connect ECONNREFUSED");
            },
        }),
    });

    await get("user-with-private-id", "Private Place Name");

    const serialized = JSON.stringify(events);
    assert.ok(events.length > 0);
    assert.ok(!serialized.includes("user-with-private-id"));
    assert.ok(!serialized.includes("Private Place Name"));
});

// --- provider errors keep existing conventions --------------------------------

test("provider HTTP errors keep their status and { error, code } body", async () => {
    const response = await handleWeatherRequest(new Request("http://localhost/api/weather?location=Nowhere"), {
        userId: "user-1",
        limiter: { limit: async () => ({ success: true, limit: 30, remaining: 29, reset: 1, pending: Promise.resolve() }) },
        getWeather: async () => {
            throw new HttpError(502, "Weather provider request failed", "WEATHER_PROVIDER_ERROR");
        },
    });

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Weather provider request failed", code: "WEATHER_PROVIDER_ERROR" });
});

test("unexpected provider failures return a generic 500 without leaking internals", async (t) => {
    silenceConsoleError(t);

    const response = await handleWeatherRequest(new Request("http://localhost/api/weather?location=Tampa"), {
        userId: "user-1",
        limiter: { limit: async () => ({ success: true, limit: 30, remaining: 29, reset: 1, pending: Promise.resolve() }) },
        getWeather: async () => {
            throw new Error("internal detail that must stay server-side");
        },
    });

    assert.equal(response.status, 500);
    const text = await response.text();
    assert.equal(text, JSON.stringify({ error: "Failed to fetch weather" }));
    assert.ok(!text.includes("internal detail"));
});
