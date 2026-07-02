import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// Global: 20 requests per 10 seconds per IP (sliding window)
export const globalLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, "10 s"),
    analytics: true,
    prefix: "runlayer:global",
});

// Auth: 5 attempts per 60 seconds per IP (fixed window)
export const authLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(5, "60 s"),
    analytics: true,
    prefix: "runlayer:auth",
});

// Recommendations: 10 requests per 60 seconds per user (sliding window)
export const recommendationsLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "60 s"),
    analytics: true,
    prefix: "runlayer:recommendations",
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