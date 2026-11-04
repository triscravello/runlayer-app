import { resolveRateLimitConfig, type EnvSource } from "./config";
import { createMemoryLimiter, DEFAULT_MEMORY_MAX_KEYS, type MemoryLimitResult, type MemoryLimiter } from "./memoryLimiter";

export type RateLimitResult = {
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
    pending: Promise<unknown>;
};

export type SafeRateLimiter = {
    limit(identifier: string): Promise<RateLimitResult>;
};

/**
 * What a limiter does when the distributed (Upstash) backend errors:
 * - "fail-open": allow the request. Suitable for non-security limiters where availability matters most.
 * - "memory-fallback": enforce the same limit with a bounded process-local limiter. Used for
 *   authentication endpoints so an outage never silently removes brute-force protection.
 * Either way the failure is reported as an event; it is never silent.
 */
export type FailurePolicy = "fail-open" | "memory-fallback";

export type RateLimiterOptions = {
    name: string;
    limit: number;
    windowSeconds: number;
    prefix: string;
    algorithm: "fixed" | "sliding";
    failurePolicy: FailurePolicy;
};

export type RateLimitEvent =
    | { type: "remote_error"; limiter: string; policy: FailurePolicy; error: string }
    | { type: "memory_eviction"; limiter: string }
    | { type: "memory_backend_in_production"; limiter: string };

export type RemoteLimiter = {
    limit(identifier: string): Promise<RateLimitResult>;
};

export type RateLimiterDeps = {
    /** Read lazily on every call so configuration is never captured at import time. */
    env: () => EnvSource;
    now: () => number;
    createRemote: (credentials: { url: string; token: string }, options: RateLimiterOptions) => RemoteLimiter;
    report: (event: RateLimitEvent) => void;
    memoryMaxKeys?: number;
};

/** Thrown when the rate-limit configuration is invalid. Requests fail loudly instead of being unprotected. */
export class RateLimitConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RateLimitConfigError";
    }
}

const MAX_ERROR_LENGTH = 200;

function sanitizeError(error: unknown, secrets: string[]): string {
    let message = error instanceof Error ? error.message : String(error);

    for (const secret of secrets) {
        if (secret) message = message.split(secret).join("[redacted]");
    }

    return message.slice(0, MAX_ERROR_LENGTH);
}

export function createRateLimiter(options: RateLimiterOptions, deps: RateLimiterDeps): SafeRateLimiter {
    const { name, limit, windowSeconds, failurePolicy } = options;
    const windowMs = windowSeconds * 1000;

    let memory: MemoryLimiter | undefined;
    let remote: RemoteLimiter | undefined;
    let reportedMemoryInProduction = false;

    const getMemory = () => {
        memory ??= createMemoryLimiter({
            limit,
            windowMs,
            maxKeys: deps.memoryMaxKeys ?? DEFAULT_MEMORY_MAX_KEYS,
            now: deps.now,
            onEvict: () => deps.report({ type: "memory_eviction", limiter: name }),
        });
        return memory;
    };

    const fromMemory = (result: MemoryLimitResult): RateLimitResult => ({ ...result, pending: Promise.resolve() });

    const failOpen = (): RateLimitResult => ({
        success: true,
        limit,
        remaining: limit,
        reset: deps.now() + windowMs,
        pending: Promise.resolve(),
    });

    return {
        async limit(identifier: string): Promise<RateLimitResult> {
            const env = deps.env();
            const resolved = resolveRateLimitConfig(env);

            if (!resolved.ok) {
                throw new RateLimitConfigError(resolved.error);
            }

            const { config } = resolved;

            if (config.backend === "memory") {
                if (env.NODE_ENV === "production" && !reportedMemoryInProduction) {
                    reportedMemoryInProduction = true;
                    deps.report({ type: "memory_backend_in_production", limiter: name });
                }

                return fromMemory(getMemory().check(identifier));
            }

            try {
                remote ??= deps.createRemote({ url: config.url, token: config.token }, options);
                return await remote.limit(identifier);
            } catch (error) {
                deps.report({
                    type: "remote_error",
                    limiter: name,
                    policy: failurePolicy,
                    error: sanitizeError(error, [config.url, config.token]),
                });

                return failurePolicy === "memory-fallback" ? fromMemory(getMemory().check(identifier)) : failOpen();
            }
        },
    };
}
