// Seed-target safety. Every seed and import entry point must pass these checks before it writes anything.
//
// This file runs under `node --experimental-strip-types`: erasable TypeScript only (no enums, namespaces or
// parameter properties) and no path aliases. It deliberately has no override, force or bypass option: a target
// is either a dedicated local database that was explicitly confirmed, or it is rejected.
//
// Error messages are fixed strings. They never contain the connection string, host, credentials or password.

type EnvSource = Readonly<Record<string, string | undefined>>;

export type SeedRejectionCode =
    | "production"
    | "hosting_environment"
    | "missing_url"
    | "invalid_url"
    | "unsupported_protocol"
    | "hosted_database"
    | "non_loopback_host"
    | "unsafe_query"
    | "invalid_database_name"
    | "missing_confirmation"
    | "confirmation_mismatch"
    | "identity_unverified"
    | "identity_mismatch"
    | "invalid_password";

export class SeedSafetyError extends Error {
    code: SeedRejectionCode;

    constructor(code: SeedRejectionCode, message: string) {
        super(message);
        this.name = "SeedSafetyError";
        this.code = code;
    }
}

export type SeedTarget = {
    database: string;
    /** "tcp": a loopback host and port. "socket": a local Unix-domain socket. */
    transport: "tcp" | "socket";
    /** Port for tcp targets (5432 when the URL omits it); null for sockets. */
    port: number | null;
};

export type TargetVerdict = { ok: true; target: SeedTarget } | { ok: false; code: SeedRejectionCode; message: string };

const MESSAGES: Record<SeedRejectionCode, string> = {
    production: "Seeding is disabled when NODE_ENV=production.",
    hosting_environment: "Seeding is disabled inside a hosting-provider environment.",
    missing_url: "DATABASE_URL is not set.",
    invalid_url: "DATABASE_URL could not be parsed safely.",
    unsupported_protocol: "DATABASE_URL must use the postgresql:// or postgres:// scheme.",
    hosted_database: "DATABASE_URL points at a hosted database provider. Seeding hosted databases is never allowed.",
    non_loopback_host:
        "DATABASE_URL does not point at this machine (a loopback host or a local Unix socket). Seeding non-local databases is never allowed.",
    unsafe_query: "DATABASE_URL contains a query parameter that is not supported for seeding.",
    invalid_database_name: 'The database name must start with "runlayer" (a dedicated local database), for example runlayer_dev.',
    missing_confirmation: "RUNLAYER_SEED_CONFIRM_DATABASE must be set to the exact database name.",
    confirmation_mismatch: "RUNLAYER_SEED_CONFIRM_DATABASE does not match the database name in DATABASE_URL.",
    identity_unverified: "Could not verify which database server the connection reaches; refusing to continue.",
    identity_mismatch: "The connected database server does not match DATABASE_URL (for example a tunnel or port-forward); refusing to continue.",
    invalid_password: "SEED_USER_PASSWORD is not acceptable.",
};

function reject(code: SeedRejectionCode): { ok: false; code: SeedRejectionCode; message: string } {
    return { ok: false, code, message: MESSAGES[code] };
}

// Environment markers set by hosting platforms. Seeding is refused when any is present.
const HOSTING_MARKERS = [
    "VERCEL",
    "VERCEL_ENV",
    "NETLIFY",
    "RENDER",
    "RAILWAY_ENVIRONMENT",
    "FLY_APP_NAME",
    "K_SERVICE",
    "AWS_LAMBDA_FUNCTION_NAME",
    "DYNO",
    "CF_PAGES",
];

// Used only to give a clearer message. Anything that is not loopback is rejected regardless of this list.
const HOSTED_SUFFIXES = [
    "supabase.co",
    "supabase.com",
    "supabase.in",
    "neon.tech",
    "amazonaws.com",
    "rds.amazonaws.com",
    "azure.com",
    "windows.net",
    "googleapis.com",
    "planetscale.com",
    "railway.app",
    "rlwy.net",
    "render.com",
    "fly.dev",
    "herokuapp.com",
    "aivencloud.com",
    "cockroachlabs.cloud",
    "elephantsql.com",
    "ondigitalocean.com",
    "scalingo.com",
    "crunchybridge.com",
    "nhost.run",
    "xata.sh",
    "timescale.com",
    "tsdb.cloud",
];

const ALLOWED_QUERY_KEYS = new Set([
    "schema",
    "connection_limit",
    "pool_timeout",
    "connect_timeout",
    "socket_timeout",
    "sslmode",
    "application_name",
    "host",
]);

const DATABASE_NAME = /^runlayer[A-Za-z0-9_-]{0,55}$/i;
const SOCKET_PATH = /^\/[A-Za-z0-9._/@+ -]{0,198}$/;
const MAX_URL_LENGTH = 2048;

function isHostedHost(host: string): boolean {
    return HOSTED_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

// Strict on purpose: only "localhost", ::1 and canonical dotted-quad 127.x.y.z. Alternate spellings that a
// resolver might map to loopback (127.1, 0x7f000001, 2130706433, localhost., localhost.localdomain, ...) are
// rejected, because a different parser could read them differently.
function isLoopbackHost(host: string): boolean {
    if (host === "localhost" || host === "::1") return true;

    const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!match) return false;

    return match.slice(1).every((octet) => (octet === "0" || !octet.startsWith("0")) && Number(octet) <= 255);
}

type ParsedUrl =
    | { ok: true; host: string; port: number | null; database: string; socketPath: string | null }
    | { ok: false; code: SeedRejectionCode; message: string };

// Manual parsing instead of new URL(): WHATWG parsing of non-special schemes differs from the parsers Prisma and
// the database driver use, and any disagreement between parsers is a bypass opportunity. Anything ambiguous is
// rejected.
function parseConnectionString(raw: string): ParsedUrl {
    if (raw.length > MAX_URL_LENGTH) return reject("invalid_url");
    // Printable ASCII only: no whitespace, control characters or non-ASCII; no backslashes or fragments.
    if (/[^\x21-\x7e]/.test(raw) || raw.includes("\\") || raw.includes("#")) return reject("invalid_url");

    const match = /^(postgres|postgresql):\/\/([^/?]*)(\/[^?]*)?(?:\?(.*))?$/.exec(raw);
    if (!match) {
        return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw) ? reject("unsupported_protocol") : reject("invalid_url");
    }

    const authority = match[2];
    const pathPart = match[3] ?? "";
    const query = match[4] ?? "";

    // At most one "@" (userinfo separator); a second one makes the host ambiguous between parsers.
    const atCount = authority.split("@").length - 1;
    if (atCount > 1) return reject("invalid_url");

    const hostPort = atCount === 1 ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
    if (hostPort.includes(",")) return reject("invalid_url"); // multi-host connection strings

    let host: string;
    let portText: string | null = null;

    if (hostPort.startsWith("[")) {
        const end = hostPort.indexOf("]");
        if (end === -1) return reject("invalid_url");
        host = hostPort.slice(1, end);
        const rest = hostPort.slice(end + 1);
        if (rest) {
            if (!rest.startsWith(":")) return reject("invalid_url");
            portText = rest.slice(1);
        }
    } else {
        const colon = hostPort.indexOf(":");
        if (colon === -1) {
            host = hostPort;
        } else {
            host = hostPort.slice(0, colon);
            portText = hostPort.slice(colon + 1);
            if (portText.includes(":")) return reject("invalid_url"); // unbracketed IPv6
        }
    }

    host = host.toLowerCase();

    let port: number | null = null;
    if (portText !== null) {
        if (!/^\d{1,5}$/.test(portText)) return reject("invalid_url");
        port = Number(portText);
        if (port < 1 || port > 65535) return reject("invalid_url");
    }

    if (host && isHostedHost(host)) return reject("hosted_database");
    if (host && !isLoopbackHost(host)) return reject("non_loopback_host");

    // Query parameters: a strict allowlist. libpq-style parameters such as hostaddr, port, dbname, user, service
    // or options can redirect the connection and are refused; "host" is accepted only as an absolute socket path.
    const params = new Map<string, string>();
    if (query) {
        for (const pair of query.split("&")) {
            if (!pair) return reject("unsafe_query");
            const eq = pair.indexOf("=");
            let key: string;
            let value: string;
            try {
                key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
                value = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1));
            } catch {
                return reject("unsafe_query");
            }
            if (!ALLOWED_QUERY_KEYS.has(key) || params.has(key) || value.length > 200) return reject("unsafe_query");
            params.set(key, value);
        }
    }

    const socketPath = params.get("host") ?? null;
    if (socketPath !== null) {
        if (!SOCKET_PATH.test(socketPath) || socketPath.split("/").includes("..")) return reject("unsafe_query");
    } else if (!host) {
        return reject("invalid_url"); // no host and no socket
    }

    if (pathPart.slice(1).includes("/")) return reject("invalid_url");
    let database: string;
    try {
        database = decodeURIComponent(pathPart.slice(1));
    } catch {
        return reject("invalid_url");
    }
    if (!DATABASE_NAME.test(database)) return reject("invalid_database_name");

    return { ok: true, host, port, database, socketPath };
}

/**
 * Decides, from configuration alone, whether the environment points at a dedicated local database that was
 * explicitly confirmed. Makes no connection. There is no override.
 */
export function evaluateSeedTarget(env: EnvSource): TargetVerdict {
    if (env.NODE_ENV === "production") return reject("production");
    if (HOSTING_MARKERS.some((marker) => Boolean(env[marker]))) return reject("hosting_environment");

    const raw = env.DATABASE_URL;
    if (!raw) return reject("missing_url");

    const parsed = parseConnectionString(raw);
    if (!parsed.ok) return parsed;

    const confirmation = env.RUNLAYER_SEED_CONFIRM_DATABASE;
    if (!confirmation) return reject("missing_confirmation");
    if (confirmation !== parsed.database) return reject("confirmation_mismatch");

    const transport = parsed.socketPath === null ? "tcp" : "socket";

    return {
        ok: true,
        target: { database: parsed.database, transport, port: transport === "tcp" ? (parsed.port ?? 5432) : null },
    };
}

// --- runtime identity ----------------------------------------------------------

export type ServerIdentity = { database: string | null; address: string | null; port: number | null };
export type IdentityVerdict = { ok: true } | { ok: false; code: SeedRejectionCode; message: string };

function isLoopbackAddress(address: string): boolean {
    const normalized = address.toLowerCase().replace(/\/\d+$/, "");
    return isLoopbackHost(normalized) && normalized !== "localhost";
}

/**
 * Compares what the server itself reports (current_database(), inet_server_addr(), inet_server_port()) with the
 * target the URL described. A loopback URL that is really an SSH tunnel or port-forward to a hosted database is
 * caught here, because the hosted server reports its own non-loopback address. Fails closed.
 */
export function evaluateServerIdentity(identity: ServerIdentity | null | undefined, target: SeedTarget): IdentityVerdict {
    if (!identity || typeof identity.database !== "string") return reject("identity_unverified");
    if (identity.database !== target.database) return reject("identity_mismatch");

    const address = identity.address ?? null;

    if (target.transport === "tcp") {
        // A TCP connection always has a server address; its absence means we cannot prove where we are.
        if (address === null) return reject("identity_unverified");
        if (!isLoopbackAddress(address)) return reject("identity_mismatch");
        if (identity.port !== target.port) return reject("identity_mismatch");
        return { ok: true };
    }

    if (address !== null && !isLoopbackAddress(address)) return reject("identity_mismatch");
    return { ok: true };
}

// --- guard -----------------------------------------------------------------------

export type AssertOptions = {
    env?: EnvSource;
    /** Asks the connected server who it is. Injected in tests; by default one read-only query via the app client. */
    queryIdentity?: () => Promise<ServerIdentity>;
};

async function defaultQueryIdentity(): Promise<ServerIdentity> {
    // Imported lazily so that merely loading this module never creates a database client, and so that the static
    // checks above always run before any client exists.
    const { prisma } = await import("../../lib/prisma.ts");
    const rows = await prisma.$queryRaw<Array<{ db: string; addr: string | null; port: number | string | null }>>`
        select current_database() as db, host(inet_server_addr()) as addr, inet_server_port() as port
    `;
    const row = rows[0];
    if (!row) throw new Error("no identity row");

    return { database: row.db, address: row.addr, port: row.port === null ? null : Number(row.port) };
}

async function verify(options: AssertOptions): Promise<SeedTarget> {
    const verdict = evaluateSeedTarget(options.env ?? process.env);
    if (!verdict.ok) throw new SeedSafetyError(verdict.code, verdict.message);

    let identity: ServerIdentity;
    try {
        identity = await (options.queryIdentity ?? defaultQueryIdentity)();
    } catch {
        // Fail closed. The cause is dropped on purpose: connection errors can echo connection details.
        throw new SeedSafetyError("identity_unverified", MESSAGES.identity_unverified);
    }

    const identityVerdict = evaluateServerIdentity(identity, verdict.target);
    if (!identityVerdict.ok) throw new SeedSafetyError(identityVerdict.code, identityVerdict.message);

    return verdict.target;
}

let cached: { key: string; promise: Promise<SeedTarget> } | undefined;

/**
 * The guard every seed and import entry point calls before any database write. Throws SeedSafetyError unless the
 * target is a confirmed, dedicated, local database and the server's own identity matches it. Successful results
 * are memoized per process for the default environment; rejections are never cached.
 */
export function assertSafeSeedTarget(options: AssertOptions = {}): Promise<SeedTarget> {
    if (options.env || options.queryIdentity) return verify(options);

    const key = [process.env.DATABASE_URL, process.env.RUNLAYER_SEED_CONFIRM_DATABASE, process.env.NODE_ENV].join("\u0000");
    if (cached && cached.key === key) return cached.promise;

    const promise = verify({});
    cached = { key, promise };
    promise.catch(() => {
        if (cached && cached.promise === promise) cached = undefined;
    });

    return promise;
}

// --- seed password policy ----------------------------------------------------------

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const WEAK_FRAGMENTS = ["password", "passw0rd", "qwerty", "letmein", "changeme", "welcome", "admin", "123456", "abcdef", "runlayer", "example"];

/**
 * Returns a reason the seed password is unacceptable, or null. The reasons never include the password.
 * There is no default: the password must be supplied through SEED_USER_PASSWORD.
 */
export function validateSeedPassword(password: string | undefined, email: string): string | null {
    if (password === undefined || password === "") return "SEED_USER_PASSWORD is required.";
    if (password !== password.trim()) return "SEED_USER_PASSWORD must not start or end with whitespace.";
    if (password.length < MIN_PASSWORD_LENGTH) return `SEED_USER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password.length > MAX_PASSWORD_LENGTH) return `SEED_USER_PASSWORD must be at most ${MAX_PASSWORD_LENGTH} characters.`;

    const lower = password.toLowerCase();
    if (new Set(lower).size < 6) return "SEED_USER_PASSWORD uses too few distinct characters.";
    if (lower.includes(email.toLowerCase())) return "SEED_USER_PASSWORD must not contain the account email.";
    if (WEAK_FRAGMENTS.some((fragment) => lower.includes(fragment))) return "SEED_USER_PASSWORD contains a common or predictable word or sequence.";

    return null;
}

/** A short, safe description of a target for status output: never the host, URL or credentials. */
export function describeTarget(target: SeedTarget): string {
    return target.transport === "tcp" ? "loopback TCP, dedicated database name confirmed" : "local Unix socket, dedicated database name confirmed";
}
