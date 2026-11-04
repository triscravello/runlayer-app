import { createHmac } from "node:crypto";
import { UNKNOWN_CLIENT_IP } from "../http/clientIp";
import {
    createRateLimiter,
    type RateLimitResult,
    type RateLimiterDeps,
    type SafeRateLimiter,
} from "./createRateLimiter";
import { rateLimitHeaders } from "./headers";

/**
 * Starting values for authentication throttling. Adjust them here; they are deliberately not environment
 * variables yet.
 *
 * Layers (a request must pass every layer that applies):
 * - flood:  one shared bucket for ALL clients ("global"). Bounds total authentication work and bounds how
 *           many distinct keys can reach the per-IP and per-email tables. A determined flood can exhaust it
 *           and block everyone for the rest of the window; that is the price of a global guard.
 * - ip:     per trusted client IP. Skipped when no trustworthy IP exists (CLIENT_IP_STRATEGY=none), so a
 *           shared "unknown" bucket can never lock all users out.
 * - email:  per HMAC-hashed normalized email, so brute force on one account is limited regardless of IP.
 *
 * Invariant (checked by tests): flood.limit * ceil(email.windowSeconds / flood.windowSeconds) is below the
 * memory limiter's key cap, so a flood of unique emails cannot evict a targeted account's counter while the
 * memory backend is in use.
 */
export const AUTH_RATE_LIMITS = {
    loginFlood: { limit: 60, windowSeconds: 60 },
    loginIp: { limit: 5, windowSeconds: 60 },
    loginEmail: { limit: 10, windowSeconds: 900 },
    signupFlood: { limit: 10, windowSeconds: 60 },
    signupIp: { limit: 5, windowSeconds: 3600 },
    signupEmail: { limit: 3, windowSeconds: 3600 },
} as const;

export type AuthLimiters = {
    loginFlood: SafeRateLimiter;
    loginIp: SafeRateLimiter;
    loginEmail: SafeRateLimiter;
    signupFlood: SafeRateLimiter;
    signupIp: SafeRateLimiter;
    signupEmail: SafeRateLimiter;
};

/**
 * Every authentication limiter uses the "memory-fallback" policy: if the distributed backend errors, the same
 * limit is still enforced by a bounded in-memory limiter, and the degradation is reported.
 * Fixed windows are used so denied attempts never extend a lockout: every limit expires on its own.
 */
export function createAuthLimiters(deps: RateLimiterDeps): AuthLimiters {
    const make = (name: string, prefix: string, config: { limit: number; windowSeconds: number }) =>
        createRateLimiter(
            { name, prefix, limit: config.limit, windowSeconds: config.windowSeconds, algorithm: "fixed", failurePolicy: "memory-fallback" },
            deps,
        );

    return {
        loginFlood: make("login_flood", "runlayer:login-flood", AUTH_RATE_LIMITS.loginFlood),
        // Name and prefix of the original per-IP login limiter are preserved.
        loginIp: make("auth", "runlayer:auth", AUTH_RATE_LIMITS.loginIp),
        loginEmail: make("login_email", "runlayer:login-email", AUTH_RATE_LIMITS.loginEmail),
        signupFlood: make("signup_flood", "runlayer:signup-flood", AUTH_RATE_LIMITS.signupFlood),
        signupIp: make("signup_ip", "runlayer:signup-ip", AUTH_RATE_LIMITS.signupIp),
        signupEmail: make("signup_email", "runlayer:signup-email", AUTH_RATE_LIMITS.signupEmail),
    };
}

// --- email keys ----------------------------------------------------------

const MAX_EMAIL_KEY_INPUT_LENGTH = 320;

/** Same normalization the login and signup routes apply before looking an account up, length-bounded. */
export function normalizeEmailForRateLimit(email: string): string {
    return email.trim().toLowerCase().slice(0, MAX_EMAIL_KEY_INPUT_LENGTH);
}

/**
 * Limiter key for an email: an HMAC-SHA256 of the normalized address (64 hex characters). The plaintext
 * address is never used as a key, so it cannot appear in Redis keys, memory tables, metrics or logs, and the
 * keyed hash cannot be reversed by guessing addresses without the secret.
 */
export function emailRateLimitKey(email: string, secret: string): string {
    return createHmac("sha256", secret).update(`rate-limit-email-v1:${normalizeEmailForRateLimit(email)}`).digest("hex");
}

// --- decisions -----------------------------------------------------------

export type ThrottleDecision = {
    allowed: boolean;
    /** The deciding result: the denying limiter's result, or the most restrictive one when allowed. */
    result: RateLimitResult;
};

/** Of two results, the one closest to its limit (lowest remaining). */
export function mostRestrictive(a: RateLimitResult, b: RateLimitResult): RateLimitResult {
    return b.remaining < a.remaining ? b : a;
}

/**
 * Network-level layers: the shared flood guard, then the per-IP limiter when a trusted client IP exists.
 * Cheap, and run before the request body is read or any password hashing happens.
 */
export async function checkNetworkLimits(
    limiters: { flood: SafeRateLimiter; ip: SafeRateLimiter },
    clientIp: string,
): Promise<ThrottleDecision> {
    const flood = await limiters.flood.limit("global");
    if (!flood.success) return { allowed: false, result: flood };

    if (clientIp === UNKNOWN_CLIENT_IP) return { allowed: true, result: flood };

    const ip = await limiters.ip.limit(clientIp);
    if (!ip.success) return { allowed: false, result: ip };

    return { allowed: true, result: mostRestrictive(flood, ip) };
}

/** Per-account layer. The key must come from emailRateLimitKey. */
export async function checkEmailLimit(limiter: SafeRateLimiter, emailKey: string): Promise<ThrottleDecision> {
    const result = await limiter.limit(emailKey);
    return { allowed: result.success, result };
}

/**
 * The 429 body and headers, identical whichever layer denied the request, so a response never reveals whether
 * an address, an IP or the global guard triggered it. Matches the existing API convention
 * ({ error, message, retryAfter } plus X-RateLimit-* and Retry-After).
 */
export function buildRateLimitedResponse(
    result: RateLimitResult,
    nowMs: number,
    copy: { error: string; message: string },
): { status: number; body: { error: string; message: string; retryAfter: number }; headers: Record<string, string> } {
    const retryAfter = Math.max(0, Math.ceil((result.reset - nowMs) / 1000));

    return {
        status: 429,
        body: { error: copy.error, message: copy.message, retryAfter },
        headers: { ...rateLimitHeaders(result.limit, 0, result.reset), "Retry-After": retryAfter.toString() },
    };
}
