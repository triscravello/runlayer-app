import { PrismaClient } from "@prisma/client";
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describeErrorForLog } from "../lib/auth/logSafe";
import { TargetError, assertTargetAllowed, parseDatabaseTarget, parseTargetAllowlist, withConnectTimeout } from "../lib/deploy/databaseTarget";
import { MigrationSetError, readMigrationSet } from "../lib/deploy/migrationFingerprint";
import { PreflightError, SESSION_SETUP_SQL, collectPreflight, type ReadOnlyQueryable } from "../lib/deploy/preflightQueries";
import { summarizeFindings } from "../lib/deploy/preflightReport";

// READ-ONLY preflight for a database that is about to be migrated. It collects evidence and writes it to a file; it never
// writes to the database, and it never creates a role, schema, table, index or temporary object.
//
//   RUNLAYER_PREFLIGHT_TARGET_URL=...  RUNLAYER_DB_ALLOWED_TARGETS=host:5432/db  npm run db:preflight -- --out preflight-<name>.json
//
// - The target comes only from RUNLAYER_PREFLIGHT_TARGET_URL. DATABASE_URL is never read, and .env is never consulted.
// - The target must be on the operator's allowlist, and the server must report the same database name before anything else is
//   collected. (A server cannot confirm its own host name, so an SSH tunnel or port-forward cannot be detected here.)
// - Everything runs in one READ ONLY transaction with bounded statement, lock and idle timeouts. Prefer a dedicated read-only
//   role; the report warns when the role can write.
// - The report contains no credentials and no personal data. --out must name a file that does not exist yet.
//
// Exit codes: 0 = passed, 2 = blocking findings (the report is still written), 1 = could not run.
const ENV_TARGET = "RUNLAYER_PREFLIGHT_TARGET_URL";
const ENV_ALLOWLIST = "RUNLAYER_DB_ALLOWED_TARGETS";
const CONNECT_TIMEOUT_SECONDS = 10;

function parseOut(argv: readonly string[]): string | null {
    if (argv.length === 2 && argv[0] === "--out" && argv[1] && !argv[1].startsWith("--")) return argv[1];
    if (argv.length === 1 && argv[0].startsWith("--out=") && argv[0].length > "--out=".length) return argv[0].slice("--out=".length);
    return null;
}

async function run(): Promise<number> {
    const out = parseOut(process.argv.slice(2));
    if (!out) {
        console.error("Usage: npm run db:preflight -- --out <new report file>");
        return 1;
    }
    if (existsSync(out)) {
        console.error("The --out file already exists; choose a new name (an existing report is never overwritten).");
        return 1;
    }
    const parent = path.dirname(path.resolve(out));
    if (!existsSync(parent) || !statSync(parent).isDirectory()) {
        console.error("The directory for --out does not exist.");
        return 1;
    }

    let target;
    try {
        target = parseDatabaseTarget(process.env[ENV_TARGET]);
        assertTargetAllowed(target, parseTargetAllowlist(process.env[ENV_ALLOWLIST]));
    } catch (error) {
        if (error instanceof TargetError) {
            const hint = error.code === "missing" ? ` Set ${ENV_TARGET}; DATABASE_URL is deliberately ignored.` : "";
            console.error(`${error.message}${hint}`);
            return 1;
        }
        throw error;
    }

    let migrationSet;
    try {
        migrationSet = readMigrationSet(path.join(process.cwd(), "prisma", "migrations"));
    } catch (error) {
        console.error(error instanceof MigrationSetError ? error.message : "The migrations could not be read.");
        return 1;
    }

    console.error(`Preflight target: ${target.key} (read-only)`);

    const client = new PrismaClient({ datasources: { db: { url: withConnectTimeout(target, CONNECT_TIMEOUT_SECONDS) } }, log: [] });
    try {
        const report = await client.$transaction(
            async (tx) => {
                // The first statement of the transaction makes it read-only; the collector then verifies that and the
                // database identity before it gathers anything else.
                for (const statement of SESSION_SETUP_SQL) await tx.$executeRawUnsafe(statement);

                const queryable: ReadOnlyQueryable = { query: async <T>(sql: string) => tx.$queryRawUnsafe<T[]>(sql) };
                return collectPreflight(queryable, { target, migrationSet, now: new Date() });
            },
            { maxWait: 10_000, timeout: 60_000 },
        );

        writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });

        console.error(`Schema state: ${report.schema.state}; pending migrations: ${report.schema.pending.length}; PostgreSQL ${report.target.serverVersion}`);
        for (const line of summarizeFindings(report)) console.error(line);
        console.error(`Verification: ${report.verification.status.toUpperCase()} (${report.verification.blockingFindings} blocking). Report written to the --out file.`);
        console.error("This report is evidence only. It does not authorize a migration.");

        return report.verification.status === "pass" ? 0 : 2;
    } catch (error) {
        console.error(error instanceof PreflightError ? error.message : `Preflight failed: ${describeErrorForLog(error)}`);
        return 1;
    } finally {
        await client.$disconnect();
    }
}

run().then(
    (code) => process.exit(code),
    (error) => {
        console.error(`Preflight failed: ${describeErrorForLog(error)}`);
        process.exit(1);
    },
);
