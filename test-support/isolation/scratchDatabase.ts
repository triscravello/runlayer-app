// Creation and cleanup of the SCRATCH databases of the two constraint suites, with every step gated on the connected server having been
// verified, on an exact name derivation, and on this run's own bookkeeping. Nothing here uses a pattern or wildcard to delete, nothing
// can name the base database, and cleanup failures are reported, never swallowed. The database access is injected, so the rules are
// testable with a fake and no connection.
import { createRequire } from "node:module";

const { isScratchDatabaseName, scratchDatabaseName } = createRequire(import.meta.url)("./target.cjs") as typeof import("./target.cjs");

export type ScratchKind = "br" | "c2";

export type ScratchAdmin = {
    /** Executes one administrative statement. Only ever CREATE DATABASE / DROP DATABASE of a validated scratch name. */
    execute: (sql: string) => Promise<unknown>;
    /** The names of every non-template database on the server (read-only). */
    listDatabases: () => Promise<string[]>;
};

/** Only sanitized reason codes (lower-case words and underscores) from a verification failure are ever copied into a message. */
const reasonCodes = (cause: unknown): string[] => {
    const reasons = (cause as { reasons?: unknown } | null | undefined)?.reasons;
    return Array.isArray(reasons) && reasons.every((reason) => typeof reason === "string" && /^[a-z0-9_]+$/.test(reason)) ? (reasons as string[]) : [];
};

export class ScratchDatabaseError extends Error {
    readonly code: string;
    readonly names: readonly string[];
    constructor(code: string, names: readonly string[] = [], detail: { cause?: unknown; note?: string } = {}) {
        const reasons = reasonCodes(detail.cause);
        super(
            `${code}${names.length ? `: ${names.join(", ")}` : ""}${detail.note ? ` (${detail.note})` : ""}${reasons.length ? ` [identity: ${reasons.join(", ")}]` : ""}`,
            detail.cause === undefined ? undefined : { cause: detail.cause },
        );
        this.name = "ScratchDatabaseError";
        this.code = code;
        this.names = names;
    }
}

export type ScratchCleanupReport = { dropped: string[]; failed: Array<{ name: string; code: string }>; leftovers: string[] };

export function createScratchDatabaseManager(input: {
    baseDatabase: string;
    kind: ScratchKind;
    /** Eight lowercase hex characters, unique to this run. */
    suffix: string;
    admin: ScratchAdmin;
    /** Re-verifies the connected server's identity (database, port, address, data directory). Throws if it is not the expected one. */
    verifyIdentity: () => Promise<void>;
}) {
    const created: string[] = [];
    /** CREATE statements that were SENT (even if one then failed): a database may exist that was never confirmed as created. */
    let attempts = 0;

    return {
        /** The databases this run created successfully, in creation order. */
        get created(): readonly string[] { return [...created]; },

        async create(label: string): Promise<string> {
            const derived = scratchDatabaseName(input.baseDatabase, input.kind, label, input.suffix);
            if (!derived.ok) throw new ScratchDatabaseError(derived.code);
            if (!isScratchDatabaseName(input.baseDatabase, derived.name, input.suffix)) throw new ScratchDatabaseError("scratch_name_not_derived");
            if (created.includes(derived.name)) throw new ScratchDatabaseError("scratch_name_reused");
            await input.verifyIdentity();
            attempts += 1;
            await input.admin.execute(`CREATE DATABASE "${derived.name}"`);
            created.push(derived.name);
            return derived.name;
        },

        /**
         * Drops ONLY the databases this run created, each by exact name, after re-verifying the server. Then reports any database that still
         * matches this run's own derivation. It deletes nothing it did not create and never retries with a broader rule.
         */
        async cleanup(): Promise<ScratchCleanupReport> {
            const report: ScratchCleanupReport = { dropped: [], failed: [], leftovers: [] };
            if (created.length === 0 && attempts === 0) return report; // nothing was ever sent: nothing to drop, and no reason to touch the server
            try {
                await input.verifyIdentity();
            } catch (cause) {
                // No DROP (and no listing) is sent to a server that failed verification. The ORIGINAL identity failure is kept as `cause`
                // and its sanitized reason codes are in the message, together with the exact names this run created and still tracks, so a
                // person can remove them deliberately. Nothing is guessed, patterned or broadened.
                throw new ScratchDatabaseError("scratch_cleanup_unverified", [...created], {
                    cause,
                    note: `no DROP was sent; ${attempts} CREATE statement(s) were sent, ${created.length} confirmed; any database named ${input.baseDatabase}_${input.kind}_<label>_${input.suffix} may remain`,
                });
            }
            for (const name of [...created].reverse()) {
                if (!isScratchDatabaseName(input.baseDatabase, name, input.suffix)) {
                    report.failed.push({ name, code: "scratch_name_not_derived" });
                    continue;
                }
                try {
                    await input.admin.execute(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
                    report.dropped.push(name);
                } catch {
                    report.failed.push({ name, code: "drop_failed" });
                }
            }
            try {
                const present = await input.admin.listDatabases();
                report.leftovers = present.filter((name) => isScratchDatabaseName(input.baseDatabase, name, input.suffix));
            } catch {
                report.failed.push({ name: "(listing)", code: "listing_failed" });
            }
            return report;
        },

        /** cleanup(), then throw if anything failed or remains, naming the databases so a person can remove them deliberately. */
        async finish(): Promise<void> {
            const report = await this.cleanup();
            const problems = [...report.failed.map((entry) => entry.name), ...report.leftovers];
            if (problems.length > 0) throw new ScratchDatabaseError("scratch_cleanup_incomplete", [...new Set(problems)]);
        },
    };
}
