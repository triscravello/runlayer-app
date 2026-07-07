import Redis from "ioredis";
import { logger } from "@/lib/logger";

const redisUrl = process.env.REDIS_URL;
const isProduction = process.env.NODE_ENV === "production";
const REDIS_RETRY_LIMIT = isProduction ? 2 : 0;
const REDIS_UNAVAILABLE_COOLDOWN_MS = 30_000;
const REDIS_LOG_THROTTLE_MS = 60_000;

type RedisLogContext = {
    operation?: string;
    status?: string;
    error?: string;
};

let redisClient: Redis | null = null;
let redisUnavailableUntil = 0;
let lastRedisLogAt = 0;
let missingConfigLogged = false;
let connectionFailureLogged = false;

function sanitizeRedisError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function logRedisFailure(message: string, context: RedisLogContext = {}, throttle = true): void {
    const now = Date.now();
    if (throttle && now - lastRedisLogAt < REDIS_LOG_THROTTLE_MS) {
        return;
    }

    lastRedisLogAt = now;
    logger.warn(message, context);
}

function markRedisUnavailable(error?: unknown, operation?: string): void {
    redisUnavailableUntil = Date.now() + REDIS_UNAVAILABLE_COOLDOWN_MS;

    if (error) {
        logRedisFailure("Redis unavailable; continuing without cache", {
            operation,
            status: redisClient?.status,
            error: sanitizeRedisError(error),
        });
    }
}

function getRedisClient(): Redis | null {
    if (!redisUrl) {
        if (!isProduction && !missingConfigLogged) {
            missingConfigLogged = true;
            logger.info("Recommendation response cache disabled because REDIS_URL is not configured");
        }
        return null;
    }

    if (redisClient) {
        return redisClient;
    }

    redisClient = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
        retryStrategy(times) {
            if (times > REDIS_RETRY_LIMIT) {
                return null;
            }
            return Math.min(times * 250, 1_000);
        },
    });

    redisClient.on("error", (error) => {
        if (!connectionFailureLogged) {
            connectionFailureLogged = true;
            markRedisUnavailable(error, "connection");
            return;
        }

        markRedisUnavailable(error, "connection");
    });

    redisClient.on("end", () => {
        markRedisUnavailable(undefined, "connection");
    });

    redisClient.on("ready", () => {
        redisUnavailableUntil = 0;
        connectionFailureLogged = false;
    });

    return redisClient;
}

function canUseRedis(client: Redis): boolean {
    if (Date.now() < redisUnavailableUntil) {
        return false;
    }

    return client.status === "wait" || client.status === "ready";
}

async function ensureRedisReady(client: Redis, operation: string): Promise<boolean> {
    if (!canUseRedis(client)) {
        return false;
    }

    if (client.status === "ready") {
        return true;
    }

    try {
        await client.connect();
        return true;
    } catch (error) {
        markRedisUnavailable(error, operation);
        return false;
    }
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
    const client = getRedisClient();
    if (!client) return null;

    const isReady = await ensureRedisReady(client, "cache-read");
    if (!isReady) return null;

    try {
        const cached = await client.get(key);
        return cached ? (JSON.parse(cached) as T) : null;
    } catch (error) {
        markRedisUnavailable(error, "cache-read");
        return null;
    }
}

export async function setCachedJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const client = getRedisClient();
    if (!client) return;

    const isReady = await ensureRedisReady(client, "cache-write");
    if (!isReady) return;

    try {
        await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (error) {
        markRedisUnavailable(error, "cache-write");
    }
}