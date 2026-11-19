// Fail-closed safety logic for preparing a DISPOSABLE local PostgreSQL database (scripts/migrateDisposable.ts).
//
// Everything here is pure: it receives its inputs as parameters, opens no connection, starts no process and reads neither process.env nor
// the file system. The entry point supplies facts (the Prisma version, what the server reported about itself, the output of a Prisma
// command) and this module decides. Every gate returns or throws a CODE, never a URL, credential or path from the caller's input.
//
// Why it exists: in Stage 2B-G1 a hand-written probe of Prisma's target failed, but the shell carried on and ran the migration. The
// design here is that nothing runs unless every earlier gate passed, the verification and the migration use ONE environment object, and
// a database name that merely looks like a test name is never accepted as proof of disposability.
//
// What it does not do: it cannot prove a database is really throwaway (that is a human judgement; the expected data directory is the
// strongest machine-checkable evidence), and it is not an OS-level network jail. See docs/disposable-database-preflight.md.

import path from "node:path";
import { TargetError, parseDatabaseTarget, type DatabaseTarget } from "../deploy/databaseTarget";
import { CHILD_ENV_PASSTHROUGH, type GuardEnv } from "../deploy/migrationGuard";

export type DisposableCode =
    | "target_missing" | "target_malformed" | "target_unsupported" | "target_ambiguous" | "target_unsafe_option" | "target_pooler"
    | "host_not_loopback_literal" | "port_missing" | "protected_port" | "port_out_of_range" | "database_name_not_disposable"
    | "query_option_not_allowed" | "data_dir_missing" | "data_dir_not_absolute" | "data_dir_ambiguous" | "data_dir_outside_root"
    | "data_dir_protected" | "root_invalid" | "prisma_version_unsupported";

export class DisposableError extends Error {
    readonly code: DisposableCode;
    constructor(code: DisposableCode) {
        super(code);
        this.name = "DisposableError";
        this.code = code;
    }
}

/** Ports that are never a disposable target: the default PostgreSQL port (a real local server may live there) and the pooler port. */
export const PROTECTED_PORTS: readonly number[] = [5432, 6543];
export const MIN_DISPOSABLE_PORT = 1024;
/** A database name must contain `test` as a whole word, after the `runlayer_` prefix: runlayer_g1_test_14, runlayer_test. */
export const DISPOSABLE_DATABASE_NAME = /^runlayer_(?:[a-z0-9]+_)*test(?:_[a-z0-9]+)*$/;
/** The only Prisma CLI line this wrapper has been audited against. A different version fails closed (prisma.config.ts may become active). */
export const SUPPORTED_PRISMA_VERSION = /^5\.22\.\d+$/;
const ALLOWED_QUERY_OPTIONS = new Set(["schema", "connect_timeout"]);
const PROTECTED_DATA_DIRECTORY_MARKERS = ["/library/application support/postgres", "/usr/local/var/postgres", "/opt/homebrew/var/postgres", "/var/lib/postgresql", "/usr/local/pgsql"];

const LOOPBACK_V4 = /^127\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

function rawHostPort(raw: string): string {
    const afterScheme = raw.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    const authority = afterScheme.split(/[/?#]/, 1)[0] ?? "";
    return authority.slice(authority.lastIndexOf("@") + 1);
}

/**
 * Parses and restricts the disposable target. Stricter than the hosted parser: a literal loopback IP (never `localhost`, never an
 * obfuscated form such as 127.1 or 2130706433), an EXPLICIT port that is neither protected nor privileged, a strict database name, and
 * no query options beyond `schema=public` and `connect_timeout`. Throws DisposableError; the message is the code only.
 */
export function parseDisposableTarget(raw: string | undefined | null): DatabaseTarget {
    let target: DatabaseTarget;
    try {
        target = parseDatabaseTarget(raw);
    } catch (error) {
        if (error instanceof TargetError) throw new DisposableError(`target_${error.code === "unsupported_protocol" ? "unsupported" : error.code}` as DisposableCode);
        throw new DisposableError("target_malformed");
    }

    // The host and port are judged on the RAW text, because a URL parser normalizes 127.1 and 0x7f.1 to 127.0.0.1 and defaults a missing port.
    const hostPort = rawHostPort(target.url);
    const ipv6 = /^\[::1\](?::(\d{1,5}))?$/.exec(hostPort);
    const ipv4 = /^([^:]+)(?::(\d{1,5}))?$/.exec(hostPort);
    let rawHost: string;
    let rawPort: string | undefined;
    if (ipv6) {
        rawHost = "[::1]";
        rawPort = ipv6[1];
    } else if (ipv4 && ipv4[1] && LOOPBACK_V4.test(ipv4[1]) && ipv4[1].split(".").every((octet) => Number(octet) <= 255)) {
        rawHost = ipv4[1];
        rawPort = ipv4[2];
    } else {
        throw new DisposableError("host_not_loopback_literal");
    }
    if (target.host !== rawHost) throw new DisposableError("host_not_loopback_literal");
    if (rawPort === undefined) throw new DisposableError("port_missing");

    if (PROTECTED_PORTS.includes(target.port)) throw new DisposableError("protected_port");
    if (target.port < MIN_DISPOSABLE_PORT) throw new DisposableError("port_out_of_range");
    if (!DISPOSABLE_DATABASE_NAME.test(target.database)) throw new DisposableError("database_name_not_disposable");

    for (const [name, value] of new URL(target.url).searchParams) {
        const option = name.toLowerCase();
        if (!ALLOWED_QUERY_OPTIONS.has(option)) throw new DisposableError("query_option_not_allowed");
        if (option === "schema" && value !== "public") throw new DisposableError("query_option_not_allowed");
        if (option === "connect_timeout" && !/^\d{1,2}$/.test(value)) throw new DisposableError("query_option_not_allowed");
    }
    return target;
}

function assertAbsoluteCanonical(value: unknown, missing: DisposableCode): string {
    if (typeof value !== "string" || value === "") throw new DisposableError(missing);
    if (/[\u0000-\u001f\u007f\s]/.test(value)) throw new DisposableError("data_dir_ambiguous");
    if (!path.isAbsolute(value)) throw new DisposableError("data_dir_not_absolute");
    if (path.normalize(value) !== value || (value.length > 1 && value.endsWith(path.sep))) throw new DisposableError("data_dir_ambiguous");
    return value;
}

/**
 * The expected data directory must be an absolute, canonical path (no `.`, `..`, doubled or trailing separators, no whitespace), strictly
 * inside an explicitly named root, and not a well-known development location. Symlinks are the caller's concern: pass realpath'd values.
 */
export function validateDataDirectory(rawDir: unknown, rawRoot: unknown): string {
    const root = (() => {
        try {
            return assertAbsoluteCanonical(rawRoot, "root_invalid");
        } catch (error) {
            if (error instanceof DisposableError && error.code !== "root_invalid") throw new DisposableError("root_invalid");
            throw error;
        }
    })();
    if (root === path.sep) throw new DisposableError("root_invalid");
    const dir = assertAbsoluteCanonical(rawDir, "data_dir_missing");
    if (!dir.startsWith(`${root}${path.sep}`)) throw new DisposableError("data_dir_outside_root");
    const lowered = dir.toLowerCase();
    if (PROTECTED_DATA_DIRECTORY_MARKERS.some((marker) => lowered.includes(marker))) throw new DisposableError("data_dir_protected");
    return dir;
}

export const validatePrismaVersion = (version: unknown): boolean => typeof version === "string" && SUPPORTED_PRISMA_VERSION.test(version);

// --- What the server says about itself ----------------------------------------------------------------------------------------------

/** Facts read from the server over a read-only session. Every field is validated; anything missing or mistyped is a failure. */
export type IdentityFacts = {
    currentDatabase: unknown;
    serverPort: unknown;
    serverAddress: unknown;
    dataDirectory: unknown;
    /** Every database that is not a template, as the server lists them. */
    databases: unknown;
    /** Base tables in the public schema. */
    publicTables: unknown;
};

export type Verdict = { ok: true } | { ok: false; reasons: string[] };

const stripMask = (address: string) => address.replace(/\/(?:32|128)$/, "");
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");

/**
 * Decides whether the server that answered is the disposable one that was expected. `expectedDataDirectory` must already be canonical
 * (see validateDataDirectory); `knownTables` is every table the schema defines, plus `_prisma_migrations`. A fresh database (no tables) is
 * accepted, and so is one that holds only known tables, so a repeat run is allowed; any unknown table fails.
 */
export function validateDatabaseIdentity(target: DatabaseTarget, expectedDataDirectory: string, facts: IdentityFacts, knownTables: ReadonlySet<string>): Verdict {
    const reasons: string[] = [];
    if (facts.currentDatabase !== target.database) reasons.push("database_name_mismatch");
    if (typeof facts.serverPort !== "number" || facts.serverPort !== target.port) reasons.push("server_port_mismatch");
    if (typeof facts.serverAddress !== "string" || !["127.0.0.1", "::1"].includes(stripMask(facts.serverAddress))) reasons.push("server_address_not_loopback");
    if (typeof facts.dataDirectory !== "string" || facts.dataDirectory !== expectedDataDirectory) reasons.push("data_directory_mismatch");

    if (!isStringArray(facts.databases)) {
        reasons.push("database_list_invalid");
    } else {
        const allowed = new Set(["postgres", target.database]);
        if (!facts.databases.includes(target.database)) reasons.push("target_database_not_listed");
        if (facts.databases.some((name) => !allowed.has(name))) reasons.push("unexpected_databases_present");
    }

    if (!isStringArray(facts.publicTables)) {
        reasons.push("table_list_invalid");
    } else if (facts.publicTables.some((name) => !knownTables.has(name))) {
        reasons.push("unexpected_schema_contents");
    }
    return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

// --- Who owns the listening port (no `ps`: `lsof` only, cross-checked with PostgreSQL's own postmaster.pid) ---------------------------
//
// `ps` is a setuid binary and cannot be executed under macOS `sandbox-exec`, so the owner is established from facts `lsof` can report
// inside the jail: the listener's pid, command name and bound address, and the process's CURRENT DIRECTORY (a running postmaster
// chdir()s into its data directory at start-up, so its cwd is the canonical data directory). `postmaster.pid` in the expected data
// directory is a second, independent witness: its pid, directory and port must agree with the live observation. A file alone proves
// nothing (it can be stale), so it can only ever add a requirement, never replace the live check.

/** What running one inspection command produced, after classification. `none` = it ran and found nothing; `unavailable` = anything else. */
export type CommandOutcome = { kind: "ok"; stdout: string } | { kind: "none" } | { kind: "unavailable" };
export type RawCommandResult = { errorCode?: string; status: number | null; stdout: string; stderr: string };

/** `lsof` exits 0 with output when it found something and 1 with no output at all when it found nothing. Everything else is unavailable. */
export function classifyLsofResult(result: RawCommandResult): CommandOutcome {
    if (result.errorCode !== undefined) return { kind: "unavailable" };   // missing binary, EPERM/EACCES from a sandbox, timeout
    if (result.status === 0 && result.stdout.trim() !== "") return { kind: "ok", stdout: result.stdout };
    if (result.status === 1 && result.stdout.trim() === "" && result.stderr.trim() === "") return { kind: "none" };
    return { kind: "unavailable" };
}

export type Listener = { pid: number; command: string; addresses: string[] };

const LISTEN_ADDRESS = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]+\]|\*):\d{1,5}$/;

/** Parses `lsof -F pcfn` output. Returns null for anything that is not exactly that format (unknown field, orphan line, bad pid/address). */
export function parseLsofListeners(stdout: string): Listener[] | null {
    const listeners: Listener[] = [];
    let current: Listener | null = null;
    for (const line of stdout.split("\n")) {
        if (line === "") continue;
        const field = line[0];
        const value = line.slice(1);
        if (field === "p") {
            if (!/^[1-9]\d{0,9}$/.test(value)) return null;
            current = { pid: Number(value), command: "", addresses: [] };
            listeners.push(current);
        } else if (current === null) {
            return null;
        } else if (field === "c") {
            if (value === "" || current.command !== "") return null;
            current.command = value;
        } else if (field === "f") {
            continue;
        } else if (field === "n") {
            if (!LISTEN_ADDRESS.test(value)) return null;
            current.addresses.push(value);
        } else {
            return null;
        }
    }
    return listeners.length > 0 && listeners.every((entry) => entry.command !== "" && entry.addresses.length > 0) ? listeners : null;
}

/** Parses `lsof -F pfn -d cwd -p <pid>` output: exactly one process (the one asked about), one `cwd` descriptor, one path. */
export function parseLsofCwd(stdout: string, pid: number): string | null {
    const lines = stdout.split("\n").filter((line) => line !== "");
    if (lines.length !== 3 || lines[0] !== `p${pid}` || lines[1] !== "fcwd" || !lines[2]?.startsWith("n/")) return null;
    return lines[2].slice(1);
}

export type PostmasterPid = { pid: number; dataDirectory: string; port: number };

/** First, second and fourth lines of PostgreSQL's postmaster.pid: the postmaster pid, the data directory and the port. */
export function parsePostmasterPid(text: string): PostmasterPid | null {
    const lines = text.split("\n");
    if (lines.length < 4 || !/^[1-9]\d{0,9}$/.test(lines[0] ?? "") || !/^[1-9]\d{0,4}$/.test(lines[3] ?? "") || !(lines[1] ?? "").startsWith("/")) return null;
    return { pid: Number(lines[0]), dataDirectory: lines[1] as string, port: Number(lines[3]) };
}

export type PortObservation = {
    /** The listeners on the port, read first. */
    listeners: readonly Listener[];
    /** The one listener's current directory. */
    cwd: string | null;
    /** The parsed postmaster.pid of the expected data directory (null if absent or malformed). */
    postmasterPid: PostmasterPid | null;
    /** The listeners on the port, read again AFTER every other observation. */
    relisted: readonly Listener[];
};

const LOOPBACK_LISTEN = /^(?:127(?:\.\d{1,3}){3}|\[::1\]):(\d{1,5})$/;
const sameListeners = (a: readonly Listener[], b: readonly Listener[]) =>
    a.length === b.length && a.every((entry, index) => entry.pid === b[index]?.pid && entry.command === b[index]?.command && [...entry.addresses].sort().join(",") === [...(b[index]?.addresses ?? [])].sort().join(","));

/**
 * The one process listening on the target's port must be a postgres server, bound only to loopback addresses (including the target's own),
 * whose current directory is exactly the expected data directory, whose postmaster.pid names the same pid, directory and port, and which
 * is still the same process after everything was read. Codes: port_not_listening, port_owner_ambiguous, port_owner_not_postgres,
 * port_listener_address_unexpected, port_owner_mismatch, postgres_identity_mismatch, port_owner_changed.
 */
export function validatePortOwner(target: Pick<DatabaseTarget, "host" | "port">, expectedDataDirectory: string, observation: PortObservation | null): Verdict {
    if (observation === null || observation.listeners.length === 0) return { ok: false, reasons: ["port_not_listening"] };
    if (observation.listeners.length > 1) return { ok: false, reasons: ["port_owner_ambiguous"] };
    const owner = observation.listeners[0] as Listener;
    const reasons: string[] = [];
    if (owner.command !== "postgres") reasons.push("port_owner_not_postgres");

    const hostPorts = owner.addresses.map((address) => {
        const match = LOOPBACK_LISTEN.exec(address);
        return match && Number(match[1]) === target.port ? address.slice(0, address.lastIndexOf(":")) : null;
    });
    if (hostPorts.some((host) => host === null) || !hostPorts.includes(target.host)) reasons.push("port_listener_address_unexpected");

    if (observation.cwd !== expectedDataDirectory) reasons.push("port_owner_mismatch");

    const file = observation.postmasterPid;
    if (file === null || file.pid !== owner.pid || file.dataDirectory !== expectedDataDirectory || file.port !== target.port) reasons.push("postgres_identity_mismatch");

    if (!sameListeners(observation.listeners, observation.relisted)) reasons.push("port_owner_changed");
    return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

// --- Schema and configuration inputs -------------------------------------------------------------------------------------------------

/** Table names the Prisma schema defines (the @@map name, else the model name) plus Prisma's own bookkeeping table. */
export function extractKnownTables(schemaText: string): ReadonlySet<string> {
    const tables = new Set<string>(["_prisma_migrations"]);
    for (const match of schemaText.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
        const mapped = /@@map\("([^"]+)"\)/.exec(match[2] ?? "");
        tables.add(mapped?.[1] ?? (match[1] as string));
    }
    return tables;
}

/** Key NAMES from a dotenv file (never the values). */
export function readEnvKeyNames(text: string): string[] {
    return [...new Set([...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((match) => match[1] as string))];
}

// --- One Prisma invocation configuration, used for BOTH verification and migration ---------------------------------------------------

export type DisposableInvocation = {
    command: string;
    args: readonly string[];
    env: Readonly<Record<string, string>>;
    cwd: string;
};

export type DisposableInvocations = { status: DisposableInvocation; deploy: DisposableInvocation };

/**
 * Builds the read-only `migrate status` invocation and the `migrate deploy` invocation from ONE frozen environment object. The
 * environment is an allowlist: the parent's DATABASE_URL and every other parent variable are ignored; the key names found in `.env`
 * files are pre-defined as empty (Prisma copies a `.env` key only when it is undefined, so hosted credentials stay out of the process);
 * and DATABASE_URL is the single validated target. The Prisma CLI is run through node, never through npx.
 */
export function buildDisposableInvocations(input: { target: DatabaseTarget; cwd: string; nodeExecutable: string; parentEnv: GuardEnv; dotenvKeyNames: readonly string[] }): DisposableInvocations {
    const env: Record<string, string> = {};
    for (const name of input.dotenvKeyNames) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) env[name] = "";
    }
    for (const name of CHILD_ENV_PASSTHROUGH) {
        const value = input.parentEnv[name];
        if (value !== undefined) env[name] = value;
    }
    env.DATABASE_URL = input.target.url;
    env.CHECKPOINT_DISABLE = "1";
    env.PRISMA_HIDE_UPDATE_MESSAGE = "1";
    env.NO_UPDATE_NOTIFIER = "1";
    env.NEXT_TELEMETRY_DISABLED = "1";
    const frozen = Object.freeze(env);

    const cli = path.join(input.cwd, "node_modules", "prisma", "build", "index.js");
    const schema = path.join(input.cwd, "prisma", "schema.prisma");
    const make = (subcommand: string): DisposableInvocation => Object.freeze({ command: input.nodeExecutable, args: Object.freeze([cli, "migrate", subcommand, "--schema", schema]), env: frozen, cwd: input.cwd });
    return { status: make("status"), deploy: make("deploy") };
}

/** True only when both invocations share the very same environment object and agree on everything but the subcommand. */
export function sameEffectiveConfiguration(a: DisposableInvocation, b: DisposableInvocation): boolean {
    return a.env === b.env && a.command === b.command && a.cwd === b.cwd && a.args.length === b.args.length && a.args.every((arg, index) => index === 2 || arg === b.args[index]);
}

// --- Reading the output of `prisma migrate status` ----------------------------------------------------------------------------------

export type StatusVerdict = { ok: true; state: "up_to_date" | "pending" } | { ok: false; reasons: string[] };

const DATASOURCE_LINE = /Datasource "db": PostgreSQL database "([^"]*)", schema "([^"]*)" at "([^"]*)"/g;
const ERROR_CODE = /\bP\d{4}\b/;   // case-sensitive: a migration NAME can contain "p1234"
const ERROR_WORDS = /Error:|have failed|failed to apply|drift|not in sync|Unexpected/i;

/**
 * The migration target as PRISMA states it, compared with the validated target, plus a check that nothing unexpected happened. The
 * datasource line must appear exactly once and match host, port, database and schema `public`. Unrecognized output is a failure.
 * ASSUMPTION (not yet checked against a live run in this stage): `migrate status` exits 0 with "Database schema is up to date!" and
 * exits 1 listing "…not yet been applied" while migrations are pending.
 */
export function evaluatePrismaStatus(output: string, exitCode: number | null, target: DatabaseTarget): StatusVerdict {
    const lines = [...output.matchAll(DATASOURCE_LINE)];
    if (lines.length !== 1) return { ok: false, reasons: [lines.length === 0 ? "prisma_target_line_missing" : "prisma_target_line_ambiguous"] };
    const [, database, schema, address] = lines[0] as RegExpMatchArray;
    const split = (address ?? "").lastIndexOf(":");
    const host = split < 0 ? "" : (address ?? "").slice(0, split);
    const port = split < 0 ? NaN : Number((address ?? "").slice(split + 1));
    const bare = (value: string) => value.replace(/^\[|\]$/g, "");

    const reasons: string[] = [];
    if (database !== target.database) reasons.push("prisma_target_database_mismatch");
    if (schema !== "public") reasons.push("prisma_target_schema_mismatch");
    if (bare(host) !== bare(target.host) || port !== target.port) reasons.push("prisma_target_address_mismatch");
    if (ERROR_CODE.test(output) || ERROR_WORDS.test(output)) reasons.push("prisma_output_reports_a_problem");
    if (reasons.length > 0) return { ok: false, reasons };

    if (exitCode === 0 && output.includes("Database schema is up to date!")) return { ok: true, state: "up_to_date" };
    if (exitCode === 1 && /not yet been applied/.test(output)) return { ok: true, state: "pending" };
    return { ok: false, reasons: ["prisma_output_unrecognized"] };
}
