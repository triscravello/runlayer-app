import { isIP } from "node:net";

/**
 * Trusted client-IP resolution for rate limiting.
 *
 * Forwarding headers are CLIENT-CONTROLLED unless a proxy you operate overwrites or appends to them, so no
 * header is trusted by default. The strategy must be chosen to match the real deployment:
 *
 * - "none" (default outside production): no header is read; every request resolves to "unknown", so all
 *   clients share one limiter bucket. Safe, but not per-client.
 * - "header:<name>": trust a single header that a hosting proxy sets and OVERWRITES on every request
 *   (for example a platform-provided client-IP header). If clients can reach the app without that proxy, or the
 *   proxy forwards a client-supplied copy, the value is spoofable.
 * - "xff-hops:<n>": the entry n-th from the RIGHT of X-Forwarded-For, for exactly n trusted proxies that each
 *   APPEND the address they saw. Entries to the left are client-controlled and are never used. If the real hop
 *   count differs from n, the result is wrong (n too small selects a proxy address; n too large selects a
 *   client-controlled value).
 *
 * Note: Next.js only fills X-Forwarded-For from the socket when the header is absent, so a client-supplied
 * value is preserved and the app cannot recover the socket address from headers. Without a trusted proxy,
 * use "none".
 */

export const UNKNOWN_CLIENT_IP = "unknown";
export const MAX_TRUSTED_HOPS = 10;
export const MAX_FORWARDED_HEADER_LENGTH = 512;

const MAX_FORWARDED_ENTRIES = 32;
const MAX_IP_LENGTH = 45; // longest textual IPv6 form
const MAX_SINGLE_HEADER_LENGTH = 64;
const MAX_HEADER_NAME_LENGTH = 64;
const FORWARDED_LIST_HEADERS = new Set(["x-forwarded-for", "forwarded"]);

export type ClientIpStrategy =
    | { kind: "none" }
    | { kind: "header"; name: string }
    | { kind: "xff-hops"; hops: number };

export type ClientIpStrategyResult =
    | { ok: true; strategy: ClientIpStrategy }
    | { ok: false; error: string };

export type HeadersLike = { get(name: string): string | null };

export class ClientIpConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ClientIpConfigError";
    }
}

const USAGE = 'CLIENT_IP_STRATEGY must be "none", "header:<name>" or "xff-hops:<n>"';

/**
 * Parses CLIENT_IP_STRATEGY. Unset or blank: "none" outside production, rejected in production so production
 * always makes an explicit choice. Error messages never echo the raw value.
 */
export function parseClientIpStrategy(raw: string | undefined, nodeEnv: string | undefined): ClientIpStrategyResult {
    const value = raw?.trim().toLowerCase();

    if (!value) {
        if (nodeEnv === "production") {
            return { ok: false, error: `CLIENT_IP_STRATEGY must be set explicitly in production. ${USAGE}` };
        }

        return { ok: true, strategy: { kind: "none" } };
    }

    if (value === "none") {
        return { ok: true, strategy: { kind: "none" } };
    }

    if (value.startsWith("header:")) {
        const name = value.slice("header:".length).trim();

        if (!name || name.length > MAX_HEADER_NAME_LENGTH || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
            return { ok: false, error: "CLIENT_IP_STRATEGY header name must be 1-64 characters of letters, digits and hyphens" };
        }

        if (FORWARDED_LIST_HEADERS.has(name)) {
            return { ok: false, error: 'CLIENT_IP_STRATEGY "header:<name>" must name a single-address header; use "xff-hops:<n>" for X-Forwarded-For' };
        }

        return { ok: true, strategy: { kind: "header", name } };
    }

    if (value.startsWith("xff-hops:")) {
        const count = value.slice("xff-hops:".length).trim();
        const hops = /^\d{1,2}$/.test(count) ? Number(count) : NaN;

        if (!Number.isInteger(hops) || hops < 1 || hops > MAX_TRUSTED_HOPS) {
            return { ok: false, error: `CLIENT_IP_STRATEGY "xff-hops:<n>" requires an integer from 1 to ${MAX_TRUSTED_HOPS}` };
        }

        return { ok: true, strategy: { kind: "xff-hops", hops } };
    }

    return { ok: false, error: USAGE };
}

// Returns a canonical textual IP, or null. Accepts only a bare IPv4/IPv6 address (no port, zone id or brackets).
function normalizeIp(value: string): string | null {
    if (value.length < 2 || value.length > MAX_IP_LENGTH) return null;

    const version = isIP(value);
    if (version === 4) return value;
    if (version !== 6 || value.includes("%")) return null;

    let host: string;
    try {
        host = new URL(`http://[${value}]/`).hostname;
    } catch {
        return null;
    }

    const canonical = host.replace(/^\[|\]$/g, "").toLowerCase();

    // IPv4-mapped IPv6 addresses resolve to the same client as their IPv4 form.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
    if (mapped) {
        const high = parseInt(mapped[1], 16);
        const low = parseInt(mapped[2], 16);
        return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }

    return canonical.length <= MAX_IP_LENGTH && isIP(canonical) === 6 ? canonical : null;
}

/**
 * Resolves the client identifier for rate limiting. Always returns either a validated, canonical IP address
 * (at most 45 characters) or UNKNOWN_CLIENT_IP, so malformed input can never create unbounded or
 * attacker-chosen limiter keys.
 */
export function resolveClientIp(headers: HeadersLike, strategy: ClientIpStrategy): string {
    switch (strategy.kind) {
        case "none":
            return UNKNOWN_CLIENT_IP;

        case "header": {
            const raw = headers.get(strategy.name);
            if (raw === null || raw.length > MAX_SINGLE_HEADER_LENGTH) return UNKNOWN_CLIENT_IP;
            return normalizeIp(raw.trim()) ?? UNKNOWN_CLIENT_IP;
        }

        case "xff-hops": {
            const raw = headers.get("x-forwarded-for");
            if (!raw || raw.length > MAX_FORWARDED_HEADER_LENGTH) return UNKNOWN_CLIENT_IP;

            const entries = raw.split(",");
            // Fewer entries than trusted hops means the header does not reflect the trusted proxy chain.
            if (entries.length > MAX_FORWARDED_ENTRIES || entries.length < strategy.hops) return UNKNOWN_CLIENT_IP;

            return normalizeIp(entries[entries.length - strategy.hops].trim()) ?? UNKNOWN_CLIENT_IP;
        }
    }
}

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Reads CLIENT_IP_STRATEGY from the given environment and resolves the client IP.
 * Throws ClientIpConfigError for an invalid or (in production) missing strategy, so a misconfiguration fails
 * loudly instead of silently trusting or ignoring headers.
 */
export function resolveClientIpFromEnv(headers: HeadersLike, env: EnvSource): string {
    const parsed = parseClientIpStrategy(env.CLIENT_IP_STRATEGY, env.NODE_ENV);

    if (!parsed.ok) {
        throw new ClientIpConfigError(parsed.error);
    }

    return resolveClientIp(headers, parsed.strategy);
}
