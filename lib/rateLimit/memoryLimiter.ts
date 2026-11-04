import { createHash } from "node:crypto";

export const DEFAULT_MEMORY_MAX_KEYS = 10_000;
const MAX_KEY_LENGTH = 128;

export type MemoryLimitResult = {
    success: boolean;
    limit: number;
    remaining: number;
    /** Epoch milliseconds at which the current window ends. */
    reset: number;
};

export type MemoryLimiter = {
    check(identifier: string): MemoryLimitResult;
    /** Number of keys currently tracked (always <= maxKeys). */
    size(): number;
};

type Entry = { count: number; resetAt: number };

// Identifiers can be attacker-influenced (headers, emails). Hash long ones so per-key memory is bounded.
function normalizeKey(identifier: string) {
    if (identifier.length <= MAX_KEY_LENGTH) return identifier;
    return `sha256:${createHash("sha256").update(identifier).digest("hex")}`;
}

/**
 * Fixed-window, process-local rate limiter.
 *
 * This is NOT a distributed limiter: every process keeps its own counters, state is lost on restart, and
 * a fixed window allows up to 2x the limit across a window boundary.
 *
 * State is bounded: at most `maxKeys` entries. Expired entries are purged first. If the table is still
 * full, the oldest entry (the one expiring soonest) is evicted and `onEvict` is called, so an attacker
 * flooding unique keys can reset counters but can never grow memory without bound.
 */
export function createMemoryLimiter({
    limit,
    windowMs,
    maxKeys = DEFAULT_MEMORY_MAX_KEYS,
    now = Date.now,
    onEvict,
}: {
    limit: number;
    windowMs: number;
    maxKeys?: number;
    now?: () => number;
    onEvict?: () => void;
}): MemoryLimiter {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error("windowMs must be a positive number");
    if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new Error("maxKeys must be a positive integer");

    // A Map iterates in insertion order. Entries are created in time order with equal window lengths,
    // so insertion order is also expiry order, which makes purging amortized O(1).
    const entries = new Map<string, Entry>();

    function purgeExpired(timestamp: number) {
        for (const [key, entry] of entries) {
            if (entry.resetAt > timestamp) break;
            entries.delete(key);
        }
    }

    function evictOldest() {
        const oldest = entries.keys().next();
        if (oldest.done) return;
        entries.delete(oldest.value);
        onEvict?.();
    }

    return {
        check(identifier: string): MemoryLimitResult {
            const timestamp = now();
            purgeExpired(timestamp);

            const key = normalizeKey(identifier);
            let entry = entries.get(key);

            // Guard against a clock that moved backwards leaving an expired entry behind the purge cursor.
            if (entry && entry.resetAt <= timestamp) {
                entries.delete(key);
                entry = undefined;
            }

            if (!entry) {
                while (entries.size >= maxKeys) evictOldest();
                entry = { count: 0, resetAt: timestamp + windowMs };
                entries.set(key, entry);
            }

            if (entry.count >= limit) {
                return { success: false, limit, remaining: 0, reset: entry.resetAt };
            }

            entry.count += 1;
            return { success: true, limit, remaining: limit - entry.count, reset: entry.resetAt };
        },
        size: () => entries.size,
    };
}
