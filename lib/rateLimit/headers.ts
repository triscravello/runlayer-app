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
