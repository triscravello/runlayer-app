import { Ratelimit, type RatelimitConfig } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logger } from "./logger";

type RateLimitResult = {
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
    pending: Promise<unknown>;
};

type SafeRateLimiter = {
    limit(identifier: string): Promise<RateLimitResult>;
};

const hasUpstashConfig = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = hasUpstashConfig ? Redis.fromEnv() : null;
const RATE_LIMIT_LOG_THROTTLE_MS = 60_000;
const rateLimitLastLogAt = new Map<string, number>();

function logRateLimitWarning(message: string, context: Record<string, unknown>): void {
    const key = `${message}:${String(context.limiter ?? "unknown")}`;
    const now = Date.now();
    const lastLogAt = rateLimitLastLogAt.get(key) ?? 0;

    if (now - lastLogAt < RATE_LIMIT_LOG_THROTTLE_MS) {
        return;
    }

    rateLimitLastLogAt.set(key, now);
    if (process.env.NODE_ENV === 'production') {
        logger.warn(message, context);
    } else {
        logger.info(message, context);
    }
}

function fallbackResponse(limit: number): RateLimitResult {
    return {
        success: true,
        limit,
        remaining: limit,
        reset: Date.now() + 60_000,
        pending: Promise.resolve(),
    };
}

function createSafeLimiter({
    name,
    limit,
    prefix,
    limiter,
}: {
    name: string;
    limit: number;
    prefix: string;
    limiter: RatelimitConfig["limiter"];
}): SafeRateLimiter {
    if (!redis) {
        logRateLimitWarning("Rate limiting disabled because Upstash Redis is not configured", { limiter: name });
        return {
            async limit() {
                return fallbackResponse(limit);
            }
        };
    }

    const ratelimit = new Ratelimit({
        redis,
        limiter,
        analytics: true,
        prefix,
    });

    return {
        async limit(identifier: string) {
            try {
                return await ratelimit.limit(identifier);
            } catch (error) {
                logRateLimitWarning("Rate limiter failed open", {
                    limiter: name,
                    error: error instanceof Error ? error.message : String(error),
                });
                return fallbackResponse(limit);
            }
        },
    };
}

// Global: 20 requests per 10 seconds per IP (sliding window)
export const globalLimiter = createSafeLimiter({
    name: "global",
    limit: 20,
    prefix: "runlayer:global",
    limiter: Ratelimit.slidingWindow(20, "10 s"),
});

// Auth: 5 attempts per 60 seconds per IP (fixed window)
export const authLimiter = createSafeLimiter({
    name: "auth",
    limit: 5,
    prefix: "runlayer:auth",
    limiter: Ratelimit.fixedWindow(5, "60 s"),
});

// Recommendations: 10 requests per 60 seconds per user (sliding window)
export const recommendationsLimiter = createSafeLimiter({
    name: "recommendations",
    limit: 10,
    prefix: "runlayer:recommendations",
    limiter: Ratelimit.slidingWindow(10, "60 s"),
});

// Helper: Extract client IP from request headers
export function getClientIp(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
        return forwarded.split(",")[0].trim();
    }
    const realIp = request.headers.get("x-real-ip");
    if (realIp) {
        return realIp;
    }
    return "anonymous";
}

// Helper: Build rate limit headers object
export function rateLimitHeaders(
    limit: number,
    remaining: number,
    reset: number
): Record<string, string> {
    return {
        "X-RateLimit-Limit": limit.toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": reset.toString(),
    };
}