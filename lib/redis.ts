import Redis from "ioredis";
import { logger } from "@/lib/logger";

const redisUrl = process.env.REDIS_URL;

export const redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false }) : null;

if (!redisUrl) {
    logger.warn("Recommendation response cache disabled because REDIS_URL is not configured");
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
    if (!redis) return null;

    try {
        if (redis.status === "wait") {
            await redis.connect();
        }
        const cached = await redis.get(key);
        return cached ? (JSON.parse(cached) as T) : null;
    } catch (error) {
        logger.error("Redis cache read failed", { error: error instanceof Error ? error.message : String(error) });
        return null;
    }
}

export async function setCachedJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!redis) return;

    try {
        if (redis.status === "wait") {
            await redis.connect();
        }
        await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (error) {
        logger.error("Redis cache write failed", { error: error instanceof Error ? error.message: String(error) });
    }
}