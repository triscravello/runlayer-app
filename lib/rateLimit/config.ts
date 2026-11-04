export type EnvSource = Readonly<Record<string, string | undefined>>;

export type RateLimitConfig =
    | { backend: "memory" }
    | { backend: "upstash"; url: string; token: string };

export type RateLimitConfigResult =
    | { ok: true; config: RateLimitConfig }
    | { ok: false; error: string };

/**
 * Resolves the rate-limit backend from the environment.
 *
 * - RATE_LIMIT_BACKEND=memory | upstash (case-insensitive). Any other value is rejected in every environment.
 * - Unset (or blank): "memory" outside production; REJECTED in production, so production never silently
 *   picks a backend.
 * - "upstash" requires both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in every environment, and
 *   never silently falls back to "memory".
 *
 * Error messages never contain credential values.
 */
export function resolveRateLimitConfig(env: EnvSource): RateLimitConfigResult {
    const raw = env.RATE_LIMIT_BACKEND?.trim().toLowerCase();

    if (!raw) {
        if (env.NODE_ENV === "production") {
            return { ok: false, error: 'RATE_LIMIT_BACKEND must be set to "memory" or "upstash" in production' };
        }

        return { ok: true, config: { backend: "memory" } };
    }

    if (raw === "memory") {
        return { ok: true, config: { backend: "memory" } };
    }

    if (raw === "upstash") {
        const url = env.UPSTASH_REDIS_REST_URL?.trim();
        const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();

        if (!url || !token) {
            return {
                ok: false,
                error: 'RATE_LIMIT_BACKEND="upstash" requires both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN',
            };
        }

        return { ok: true, config: { backend: "upstash", url, token } };
    }

    return { ok: false, error: 'RATE_LIMIT_BACKEND must be "memory" or "upstash"' };
}
