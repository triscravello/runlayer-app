// Parsing and approval of an explicitly named database target, for the guarded migration command and the read-only
// preflight. Pure: it reads only the strings it is given, never process.env, never a file, and never opens a connection.
//
// Every error message is a FIXED string. No message ever contains the connection string, a host, a user name or a
// password, so an error can be printed or logged as is. A caller that wants to show the target prints `target.key`
// (host:port/database), which holds no credentials.

export type TargetErrorCode =
    | "missing"
    | "malformed"
    | "unsupported_protocol"
    | "ambiguous"
    | "unsafe_option"
    | "pooler"
    | "allowlist_missing"
    | "allowlist_invalid"
    | "not_allowed"
    | "confirmation_missing"
    | "confirmation_mismatch";

const MESSAGES: Record<TargetErrorCode, string> = {
    missing: "No database target was supplied.",
    malformed: "The database target is not a well-formed PostgreSQL connection URL.",
    unsupported_protocol: "The database target must use the postgresql:// or postgres:// scheme.",
    ambiguous: "The database target is ambiguous (repeated or conflicting parts, several hosts, or more than one '@').",
    unsafe_option: "The database target contains a connection option that is not permitted here.",
    pooler: "The database target looks like a transaction pooler (port 6543 or pgbouncer=true). Migrations need a direct or session-mode connection.",
    allowlist_missing: "No target allowlist was supplied.",
    allowlist_invalid: "The target allowlist contains an entry that is not an exact host:port/database.",
    not_allowed: "The database target is not on the operator-approved allowlist.",
    confirmation_missing: "No target confirmation was supplied.",
    confirmation_mismatch: "The target confirmation does not exactly match the database target.",
};

export class TargetError extends Error {
    readonly code: TargetErrorCode;

    constructor(code: TargetErrorCode) {
        super(MESSAGES[code]);
        this.name = "TargetError";
        this.code = code;
    }
}

export type DatabaseTarget = {
    host: string;
    port: number;
    database: string;
    /** `host:port/database`, lower-cased host. Contains no credentials; safe to print and to store in evidence. */
    key: string;
    /** The connection URL exactly as supplied (trimmed). Contains credentials: never print or log it. */
    url: string;
};

const MAX_URL_LENGTH = 2048;
const DEFAULT_PORT = 5432;
const TRANSACTION_POOLER_PORT = 6543;

/** Connection options that are harmless. Everything else (host, hostaddr, port, dbname, options, service, ...) is refused. */
const ALLOWED_OPTIONS = new Set(["sslmode", "schema", "connect_timeout", "connection_limit", "pool_timeout", "sslaccept", "application_name"]);

const HOSTNAME = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const IPV6_HOST = /^\[[0-9a-f:.]+\]$/;
const DATABASE_NAME = /^[A-Za-z0-9_.$-]{1,63}$/;
const SCHEMA_NAME = /^[A-Za-z0-9_]{1,63}$/;
const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f]/;

/**
 * Parses a PostgreSQL connection URL into a target, or throws a TargetError. Strict on purpose: it refuses anything that
 * could make the real destination differ from the one that gets approved (a second host, a `host=` query override,
 * several '@', percent-encoded or wildcard host names).
 */
export function parseDatabaseTarget(raw: string | undefined | null): DatabaseTarget {
    if (typeof raw !== "string" || raw.trim() === "") throw new TargetError("missing");

    const url = raw.trim();
    if (url.length > MAX_URL_LENGTH || CONTROL_OR_SPACE.test(url)) throw new TargetError("malformed");

    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
    if (!scheme) throw new TargetError("malformed");
    if (!["postgresql", "postgres"].includes(scheme[1].toLowerCase())) throw new TargetError("unsupported_protocol");

    // The authority, taken from the raw text so that nothing a URL parser normalizes can hide a second host or '@'.
    const afterScheme = url.slice(scheme[0].length);
    const authority = afterScheme.split(/[/?#]/, 1)[0];
    if ((authority.match(/@/g) ?? []).length > 1) throw new TargetError("ambiguous");

    const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
    if (hostPort.includes(",")) throw new TargetError("ambiguous");
    if (hostPort.includes("*") || hostPort.includes("%")) throw new TargetError("malformed");

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new TargetError("malformed");
    }

    if (parsed.hash) throw new TargetError("malformed");

    const host = parsed.hostname.toLowerCase();
    if (!host || !(HOSTNAME.test(host) || IPV6_HOST.test(host))) throw new TargetError("malformed");

    let port = DEFAULT_PORT;
    if (parsed.port !== "") {
        if (!/^\d{1,5}$/.test(parsed.port)) throw new TargetError("malformed");
        port = Number(parsed.port);
        if (port < 1 || port > 65535) throw new TargetError("malformed");
    }

    const segments = parsed.pathname.split("/");
    if (segments.length !== 2 || segments[0] !== "" || segments[1] === "") throw new TargetError("malformed");
    let database: string;
    try {
        database = decodeURIComponent(segments[1]);
    } catch {
        throw new TargetError("malformed");
    }
    if (!DATABASE_NAME.test(database)) throw new TargetError("malformed");

    const seen = new Set<string>();
    for (const [name, value] of parsed.searchParams) {
        const option = name.toLowerCase();
        if (option === "pgbouncer") throw new TargetError("pooler");
        if (!ALLOWED_OPTIONS.has(option)) throw new TargetError("unsafe_option");
        if (seen.has(option)) throw new TargetError("ambiguous");
        seen.add(option);
        if (option === "schema" && !SCHEMA_NAME.test(value)) throw new TargetError("malformed");
    }

    if (port === TRANSACTION_POOLER_PORT) throw new TargetError("pooler");

    return { host, port, database, key: `${host}:${port}/${database}`, url };
}

const ALLOWLIST_ENTRY = /^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?):(\d{1,5})\/[A-Za-z0-9_.$-]{1,63}$/;
const MAX_ALLOWLIST_ENTRIES = 20;

/**
 * Parses an operator-supplied allowlist: exact `host:port/database` entries separated by commas or whitespace. There are
 * no wildcards, patterns, defaults or implicit ports. A single malformed entry rejects the whole list.
 */
export function parseTargetAllowlist(raw: string | undefined | null): ReadonlySet<string> {
    if (typeof raw !== "string" || raw.trim() === "") throw new TargetError("allowlist_missing");

    const entries = raw.split(/[\s,]+/).filter((entry) => entry !== "");
    if (entries.length === 0) throw new TargetError("allowlist_missing");
    if (entries.length > MAX_ALLOWLIST_ENTRIES) throw new TargetError("allowlist_invalid");

    const approved = new Set<string>();
    for (const entry of entries) {
        const slash = entry.indexOf("/");
        if (slash < 0) throw new TargetError("allowlist_invalid");

        // The database part keeps its case (PostgreSQL names are case sensitive); only host:port is folded.
        const canonical = `${entry.slice(0, slash).toLowerCase()}${entry.slice(slash)}`;
        const match = ALLOWLIST_ENTRY.exec(canonical);
        if (!match) throw new TargetError("allowlist_invalid");

        const port = Number(match[2]);
        if (port < 1 || port > 65535) throw new TargetError("allowlist_invalid");

        approved.add(canonical);
    }

    return approved;
}

/** Throws unless the target is exactly one of the approved entries. */
export function assertTargetAllowed(target: DatabaseTarget, allowlist: ReadonlySet<string>): void {
    if (!allowlist.has(target.key)) throw new TargetError("not_allowed");
}

/**
 * The operator must type the full `host:port/database` of the target. The database name alone is not enough: hosted
 * providers commonly name every database `postgres`.
 */
export function assertTargetConfirmed(target: DatabaseTarget, confirmation: string | undefined | null): void {
    if (typeof confirmation !== "string" || confirmation === "") throw new TargetError("confirmation_missing");
    if (confirmation !== target.key) throw new TargetError("confirmation_mismatch");
}

/** Returns the target URL with a bounded connect timeout added when the operator did not set one. Never printed. */
export function withConnectTimeout(target: DatabaseTarget, seconds: number): string {
    const parsed = new URL(target.url);
    if (!parsed.searchParams.has("connect_timeout")) parsed.searchParams.set("connect_timeout", String(seconds));
    return parsed.toString();
}
