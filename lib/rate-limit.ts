import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { resolveAuthSecret } from "./auth/secret";
import { resolveClientIpFromEnv } from "./http/clientIp";
import { logger } from "./logger";
import { rateLimitBackendEventsTotal } from "./metrics";
import { createAuthLimiters, emailRateLimitKey } from "./rateLimit/authThrottle";
import { createWeatherLimiter } from "./weather/weatherRequest";
import {
    createRateLimiter,
    type RateLimitEvent,
    type RateLimiterDeps,
    type RateLimiterOptions,
    type RemoteLimiter,
} from "./rateLimit/createRateLimiter";

const RATE_LIMIT_LOG_THROTTLE_MS = 60_000;
const rateLimitLastLogAt = new Map<string, number>();

function shouldLog(key: string): boolean {
    const now = Date.now();
    const lastLogAt = rateLimitLastLogAt.get(key) ?? 0;

    if (now - lastLogAt < RATE_LIMIT_LOG_THROTTLE_MS) {
        return false;
    }

    rateLimitLastLogAt.set(key, now);
    return true;
}

// Every degradation of the rate-limit backend is counted (bounded labels) and logged (throttled).
function reportRateLimitEvent(event: RateLimitEvent): void {
    const eventLabel = event.type === "remote_error" ? `remote_error_${event.policy === "fail-open" ? "fail_open" : "memory_fallback"}` : event.type;
    rateLimitBackendEventsTotal.inc({ limiter: event.limiter, event: eventLabel });

    if (!shouldLog(`${eventLabel}:${event.limiter}`)) {
        return;
    }

    switch (event.type) {
        case "remote_error":
            logger.error(
                event.policy === "memory-fallback"
                    ? "Rate limit backend failed; using bounded in-memory fallback (process-local, weaker than distributed limiting)"
                    : "Rate limit backend failed; failing open (requests are not throttled)",
                { limiter: event.limiter, policy: event.policy, error: event.error },
            );
            break;
        case "memory_eviction":
            logger.warn("Rate limit memory table is full; evicting oldest entries", { limiter: event.limiter });
            break;
        case "memory_backend_in_production":
            logger.warn(
                "Rate limiting uses the in-memory backend in production. Limits are process-local and are not shared across instances; this is not equivalent to distributed rate limiting.",
                { limiter: event.limiter },
            );
            break;
    }
}

function createUpstashLimiter(credentials: { url: string; token: string }, options: RateLimiterOptions): RemoteLimiter {
    const window = `${options.windowSeconds} s` as `${number} s`;
    const ratelimit = new Ratelimit({
        redis: new Redis({ url: credentials.url, token: credentials.token }),
        limiter:
            options.algorithm === "fixed"
                ? Ratelimit.fixedWindow(options.limit, window)
                : Ratelimit.slidingWindow(options.limit, window),
        analytics: true,
        prefix: options.prefix,
    });

    return { limit: (identifier: string) => ratelimit.limit(identifier) };
}

const deps: RateLimiterDeps = {
    env: () => process.env,
    now: Date.now,
    createRemote: createUpstashLimiter,
    report: reportRateLimitEvent,
};

// Backend selection (RATE_LIMIT_BACKEND) and validation happen lazily on first use; see lib/rateLimit/config.ts.
// "memory" is process-local and is NOT equivalent to distributed limiting across multiple instances.

// Global: 20 requests per 10 seconds per IP (sliding window). Fails open if Upstash errors.
export const globalLimiter = createRateLimiter(
    { name: "global", limit: 20, windowSeconds: 10, prefix: "runlayer:global", algorithm: "sliding", failurePolicy: "fail-open" },
    deps,
);

// Authentication limiters (login and signup), created from the shared limits in lib/rateLimit/authThrottle.ts.
// All of them fall back to a bounded in-memory limiter if Upstash errors.
export const authLimiters = createAuthLimiters(deps);

// Login, per trusted client IP: 5 attempts per 60 seconds (fixed window).
export const authLimiter = authLimiters.loginIp;

// HMAC key for an email's limiter key; the plaintext address is never used as a key.
export function getEmailRateLimitKey(email: string): string {
    return emailRateLimitKey(email, resolveAuthSecret(process.env));
}

// Recommendations: 10 requests per 60 seconds per user (sliding window). Fails open if Upstash errors.
export const recommendationsLimiter = createRateLimiter(
    { name: "recommendations", limit: 10, windowSeconds: 60, prefix: "runlayer:recommendations", algorithm: "sliding", failurePolicy: "fail-open" },
    deps,
);

// Weather: 30 requests per 60 seconds per authenticated user (sliding window). Falls back to a bounded in-memory
// limiter if Upstash errors, so the shared weather-provider quota stays protected during an outage.
export const weatherLimiter = createWeatherLimiter(deps);

// Helper: Resolve the client identifier used as the rate-limit key.
// Forwarding headers are never trusted by default: CLIENT_IP_STRATEGY (none | header:<name> | xff-hops:<n>)
// selects what, if anything, to trust. Returns a validated IP or "unknown"; throws ClientIpConfigError if the
// strategy is invalid or (in production) unset. See lib/http/clientIp.ts.
export function getClientIp(request: Request): string {
    return resolveClientIpFromEnv(request.headers, process.env);
}

// Helper: Build rate limit headers object (implementation lives in lib/rateLimit/headers.ts)
export { rateLimitHeaders } from "./rateLimit/headers";
