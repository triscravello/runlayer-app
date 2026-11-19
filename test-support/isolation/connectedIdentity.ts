// A live, read-only check of WHICH server a test is talking to, to run before any application-table mutation or administrative
// statement. A matching URL is not evidence of this: the URL says where the client was pointed, these facts say what answered.
// The query itself is injected (each suite has its own client), so the decision logic is testable with plain objects.
import { createRequire } from "node:module";

const { checkExpectedDataDirectory } = createRequire(import.meta.url)("./target.cjs") as typeof import("./target.cjs");

/** What the server reports about itself: `select current_database(), inet_server_port(), host(inet_server_addr()), current_setting('data_directory')`. */
export type ConnectedFacts = { db: unknown; port: unknown; addr: unknown; dataDirectory: unknown };
export type ExpectedIdentity = { database: string; port: number; host: string; dataDirectory: string };

export class ConnectedIdentityError extends Error {
    readonly reasons: readonly string[];
    constructor(reasons: readonly string[]) {
        super(`connected database identity check failed: ${reasons.join(", ")}`);
        this.name = "ConnectedIdentityError";
        this.reasons = reasons;
    }
}

const LOOPBACK_ADDRESS: Record<string, string> = { "127.0.0.1": "127.0.0.1", "[::1]": "::1" };

export function evaluateConnectedIdentity(expected: ExpectedIdentity, facts: ConnectedFacts): { ok: true } | { ok: false; reasons: string[] } {
    const reasons: string[] = [];
    if (facts === null || typeof facts !== "object") return { ok: false, reasons: ["identity_facts_invalid"] };
    if (facts.db !== expected.database) reasons.push("identity_database_mismatch");
    const port = typeof facts.port === "bigint" ? Number(facts.port) : facts.port;
    if (typeof port !== "number" || port !== expected.port) reasons.push("identity_port_mismatch");
    const expectedAddress = LOOPBACK_ADDRESS[expected.host] ?? (expected.host.startsWith("127.") ? expected.host : undefined);
    if (typeof facts.addr !== "string" || expectedAddress === undefined || facts.addr !== expectedAddress) reasons.push("identity_address_mismatch");
    if (typeof facts.dataDirectory !== "string" || facts.dataDirectory !== expected.dataDirectory) reasons.push("identity_data_directory_mismatch");
    return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** Reads RUNLAYER_TEST_EXPECTED_DATA_DIR (set by scripts/runTests.mjs from the wrapper's validated directory). Throws if it is absent or not canonical. */
export function expectedDataDirectoryFromEnv(env: Readonly<Record<string, string | undefined>>): string {
    const directory = checkExpectedDataDirectory(env.RUNLAYER_TEST_EXPECTED_DATA_DIR);
    if (!directory.ok) throw new ConnectedIdentityError([`expected_${directory.code}`]);
    return directory.dataDirectory;
}

/** Runs the injected query and throws ConnectedIdentityError unless the server is exactly the expected one. Call it before any write. */
export async function verifyConnectedIdentity(query: () => Promise<ConnectedFacts>, expected: ExpectedIdentity): Promise<void> {
    let facts: ConnectedFacts;
    try {
        facts = await query();
    } catch {
        throw new ConnectedIdentityError(["identity_query_failed"]);
    }
    const verdict = evaluateConnectedIdentity(expected, facts);
    if (!verdict.ok) throw new ConnectedIdentityError(verdict.reasons);
}

/** The expected identity for a validated target URL and the expected data directory. */
export function expectedIdentityFor(targetUrl: string, dataDirectory: string): ExpectedIdentity {
    const url = new URL(targetUrl);
    return { database: decodeURIComponent(url.pathname.replace(/^\//, "")), port: Number(url.port), host: url.hostname.toLowerCase(), dataDirectory };
}
