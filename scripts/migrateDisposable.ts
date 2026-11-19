import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { runDisposableMigration, type DisposableDeps } from "../lib/testdb/disposableMigration";
import { classifyLsofResult, type CommandOutcome } from "../lib/testdb/disposableTarget";

// Fail-closed preparation of a DISPOSABLE local PostgreSQL database for the opt-in integration suites.
//
//   npm run db:disposable:check      CHECK ONLY: runs every gate and `prisma migrate status`, then stops. Never migrates.
//   npm run db:disposable:migrate    The same gates, then `prisma migrate deploy` against the verified target only.
//
// All three inputs are explicit and come only from these variables (DATABASE_URL and .env are never consulted):
//   RUNLAYER_DISPOSABLE_URL         postgresql://USER[:PASSWORD]@127.0.0.1:PORT/runlayer_..._test_...   (literal loopback IP, explicit non-protected port)
//   RUNLAYER_DISPOSABLE_DATA_DIR    the absolute, canonical data directory of the throwaway cluster
//   RUNLAYER_DISPOSABLE_ROOT        the absolute directory that must contain that data directory (for example your scratch folder)
//
// Exit codes: 0 = every gate passed (and Prisma succeeded, in migrate mode); 3 = refused by a gate; 1 = could not run.
// This wrapper cannot prove a database is throwaway, and it is not an OS-level network jail. See docs/disposable-database-preflight.md.
const EXECUTE_SCRIPT_NAME = "db:disposable:migrate";
const EXIT_REFUSED = 3;
const requireFromHere = createRequire(import.meta.url);

function readText(file: string): string | null {
    try {
        return readFileSync(file, "utf8");
    } catch {
        return null;
    }
}

function realDirectory(directory: string): string | null {
    try {
        const real = realpathSync(directory);
        return statSync(real).isDirectory() ? real : null;
    } catch {
        return null;
    }
}

// `ps` is not used anywhere: it is setuid and cannot be executed under macOS `sandbox-exec`. Only `lsof` is run, by absolute path (never
// resolved through PATH), with an argument array (no shell), integer-only arguments and a fixed minimal environment. No fallback exists:
// if lsof is missing, denied, times out or prints anything unexpected, the port_owner gate refuses.
const LSOF = ["/usr/sbin/lsof", "/usr/bin/lsof"].find((candidate) => existsSync(candidate));
const LSOF_ENV = { PATH: "/usr/bin:/bin", LC_ALL: "C" } as unknown as NodeJS.ProcessEnv;

function runLsof(args: string[]): CommandOutcome {
    if (LSOF === undefined) return { kind: "unavailable" };
    const result = spawnSync(LSOF, args, { encoding: "utf8", env: LSOF_ENV, timeout: 10_000, shell: false });
    return classifyLsofResult({ errorCode: result.error ? ((result.error as NodeJS.ErrnoException).code ?? "ERROR") : undefined, status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
}

function readPostmasterPid(dataDirectory: string): string | null {
    try {
        return readFileSync(path.join(dataDirectory, "postmaster.pid"), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

async function main(): Promise<number> {
    const cwd = process.cwd();
    if (!existsSync(path.join(cwd, "prisma", "schema.prisma")) || !existsSync(path.join(cwd, "prisma", "migrations"))) {
        console.error("Run this from the repository root (prisma/schema.prisma and prisma/migrations were not found).");
        return 1;
    }
    const execute = process.argv.slice(2).includes("--execute");
    if (process.argv.slice(2).some((arg) => arg !== "--execute")) {
        console.error("Unknown argument. The only option is --execute, and only through `npm run db:disposable:migrate`.");
        return 1;
    }
    if (execute && process.env.npm_lifecycle_event !== EXECUTE_SCRIPT_NAME) {
        console.error(`--execute is only accepted through \`npm run ${EXECUTE_SCRIPT_NAME}\`.`);
        return EXIT_REFUSED;
    }

    const deps: DisposableDeps = {
        cwd,
        nodeExecutable: process.execPath,
        parentEnv: process.env,
        readPrismaVersion: () => {
            const text = readText(path.join(cwd, "node_modules", "prisma", "package.json"));
            return text ? (JSON.parse(text) as { version?: string }).version ?? null : null;
        },
        readDotenvTexts: () => [path.join(cwd, ".env"), path.join(cwd, "prisma", ".env")].map(readText).filter((text): text is string => text !== null),
        readSchemaText: () => readFileSync(path.join(cwd, "prisma", "schema.prisma"), "utf8"),
        realpathDirectory: realDirectory,
        listListeners: (port) => runLsof(["-nP", `-iTCP:${Number(port)}`, "-sTCP:LISTEN", "-F", "pcfn"]),
        readProcessCwd: (pid) => runLsof(["-nP", "-a", "-p", String(Number(pid)), "-d", "cwd", "-F", "pfn"]),
        readPostmasterPid,
        // A direct, read-only session that does not involve Prisma or any Prisma configuration.
        queryIdentityFacts: async (target) => {
            const { Client } = requireFromHere("pg") as { Client: new (options: object) => { connect(): Promise<void>; query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>; end(): Promise<void> } };
            const client = new Client({ connectionString: target.url, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
            await client.connect();
            try {
                await client.query("begin read only");
                const [self] = (await client.query("select current_database() as db, inet_server_port() as port, host(inet_server_addr()) as addr, current_setting('data_directory') as dir")).rows;
                const databases = (await client.query("select datname from pg_database where not datistemplate")).rows.map((row) => row.datname);
                const tables = (await client.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")).rows.map((row) => row.table_name);
                await client.query("rollback");
                return { currentDatabase: self?.db, serverPort: self?.port, serverAddress: self?.addr, dataDirectory: self?.dir, databases, publicTables: tables };
            } finally {
                await client.end();
            }
        },
        runPrisma: (invocation) => {
            const result = spawnSync(invocation.command, [...invocation.args], { cwd: invocation.cwd, env: invocation.env as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
            if (result.error) return { started: false, status: null, output: "" };
            process.stdout.write(result.stdout ?? "");
            process.stderr.write(result.stderr ?? "");
            return { started: true, status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
        },
    };

    const result = await runDisposableMigration(
        { url: process.env.RUNLAYER_DISPOSABLE_URL, dataDirectory: process.env.RUNLAYER_DISPOSABLE_DATA_DIR, allowedRoot: process.env.RUNLAYER_DISPOSABLE_ROOT, execute },
        deps,
    );
    if (!result.ok) {
        console.error(`REFUSED at the ${result.stage} gate. ${result.stage === "migrate" ? "Prisma did not succeed." : "Nothing after it was run."}`);
        for (const reason of result.reasons) console.error(`  - ${reason}`);
        console.error(`Gates passed before the refusal: ${result.completed.join(", ") || "(none)"}`);
        return result.stage === "migrate" ? 1 : EXIT_REFUSED;
    }
    console.log(`All gates passed: ${result.completed.join(" > ")}. Prisma status: ${result.prismaState}. Mode: ${result.mode}.`);
    return 0;
}

main().then((code) => process.exit(code), () => { console.error("The wrapper could not run."); process.exit(1); });
