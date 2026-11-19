import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runDisposableMigration, type DisposableConfig, type DisposableDeps, type DisposableStage, type PrismaRun } from "./disposableMigration";
import type { CommandOutcome, DisposableInvocation, IdentityFacts } from "./disposableTarget";

// Ordering and failure propagation, with every side effect replaced by a recording fake. No database, process or network is involved.

const SCHEMA = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");
const URL_OK = "postgresql://u:pw@127.0.0.1:54341/runlayer_g1_test_14";
const ROOT = "/tmp/scratch/g1";
const DIR = `${ROOT}/pg14`;
const UP_TO_DATE = 'Datasource "db": PostgreSQL database "runlayer_g1_test_14", schema "public" at "127.0.0.1:54341"\n\nDatabase schema is up to date!\n';
const PENDING = 'Datasource "db": PostgreSQL database "runlayer_g1_test_14", schema "public" at "127.0.0.1:54341"\n\nFollowing migrations have not yet been applied:\n2026_x\n';

// What `lsof -F pcfn` / `lsof -F pfn -d cwd` / postmaster.pid would say for a healthy disposable server.
const ok = (stdout: string): CommandOutcome => ({ kind: "ok", stdout });
const listen = (pid = 4242, command = "postgres", addresses: string[] = ["127.0.0.1:54341"]) => `p${pid}\nc${command}\nf5\n${addresses.map((address) => `n${address}`).join("\n")}\n`;
const cwdOut = (pid = 4242, dir = DIR) => `p${pid}\nfcwd\nn${dir}\n`;
const pidFile = (pid = 4242, dir = DIR, port = 54341) => `${pid}\n${dir}\n1763560000\n${port}\n\n127.0.0.1\n  1234 5678\nready   \n`;

type Fakes = { calls: string[]; prisma: Array<{ subcommand: string; invocation: DisposableInvocation }>; deps: DisposableDeps };

function fakes(over: Partial<DisposableDeps> = {}, runs: { status?: PrismaRun; deploy?: PrismaRun } = {}): Fakes {
    const calls: string[] = [];
    const prisma: Fakes["prisma"] = [];
    const facts = (): IdentityFacts => ({ currentDatabase: "runlayer_g1_test_14", serverPort: 54341, serverAddress: "127.0.0.1", dataDirectory: DIR, databases: ["postgres", "runlayer_g1_test_14"], publicTables: [] });
    const deps: DisposableDeps = {
        cwd: "/repo", nodeExecutable: "/usr/bin/node", parentEnv: { PATH: "/usr/bin", DATABASE_URL: "postgresql://attacker:x@db.example.invalid:5432/prod" },
        readPrismaVersion: () => { calls.push("version"); return "5.22.0"; },
        readDotenvTexts: () => { calls.push("dotenv"); return ["DATABASE_URL=hosted\nSUPABASE_URL=hosted\n"]; },
        readSchemaText: () => { calls.push("schema"); return SCHEMA; },
        realpathDirectory: (directory) => { calls.push("realpath"); return directory; },
        listListeners: () => { calls.push("listeners"); return ok(listen()); },
        readProcessCwd: () => { calls.push("cwd"); return ok(cwdOut()); },
        readPostmasterPid: () => { calls.push("pidfile"); return pidFile(); },
        queryIdentityFacts: async () => { calls.push("identity"); return facts(); },
        runPrisma: (invocation) => {
            const subcommand = invocation.args[2] as string;
            calls.push(`prisma:${subcommand}`);
            prisma.push({ subcommand, invocation });
            return subcommand === "status" ? (runs.status ?? { started: true, status: 0, output: UP_TO_DATE }) : (runs.deploy ?? { started: true, status: 0, output: "All migrations have been successfully applied." });
        },
        ...over,
    };
    return { calls, prisma, deps };
}
const config = (over: Partial<DisposableConfig> = {}): DisposableConfig => ({ url: URL_OK, dataDirectory: DIR, allowedRoot: ROOT, execute: false, ...over });
const deployCalls = (f: Fakes) => f.calls.filter((call) => call === "prisma:deploy").length;

test("check mode runs every gate in order, runs `migrate status` once, and never runs `migrate deploy`", async () => {
    const f = fakes();
    const result = await runDisposableMigration(config(), f.deps);
    assert.deepEqual(result, { ok: true, mode: "check", completed: ["target", "data_directory", "prisma_version", "port_owner", "identity", "prisma_status"], prismaState: "up_to_date" });
    assert.deepEqual(f.calls, ["realpath", "version", "schema", "dotenv", "listeners", "cwd", "pidfile", "listeners", "identity", "prisma:status"]);
    assert.equal(deployCalls(f), 0);
});

test("execute mode runs `migrate deploy` exactly once, last, with the same environment object as the verification", async () => {
    const f = fakes({}, { status: { started: true, status: 1, output: PENDING } });
    const result = await runDisposableMigration(config({ execute: true }), f.deps);
    assert.deepEqual(result, { ok: true, mode: "migrate", completed: ["target", "data_directory", "prisma_version", "port_owner", "identity", "prisma_status", "migrate"], prismaState: "pending" });
    assert.deepEqual(f.calls.slice(-2), ["prisma:status", "prisma:deploy"]);
    assert.equal(f.prisma.length, 2);
    const [status, deploy] = f.prisma as [Fakes["prisma"][number], Fakes["prisma"][number]];
    assert.equal(status.invocation.env, deploy.invocation.env, "one environment object");
    assert.equal(status.invocation.env.DATABASE_URL, URL_OK);
    assert.equal(status.invocation.env.SUPABASE_URL, "", "hosted .env keys are neutralized");
    assert.equal("DIRECT_URL" in status.invocation.env, false);
});

type Failure = { name: string; stage: DisposableStage; config?: Partial<DisposableConfig>; deps?: Partial<DisposableDeps>; runs?: { status?: PrismaRun }; reason: string; notCalled: string[] };
const FAILURES: Failure[] = [
    { name: "missing URL", stage: "target", config: { url: undefined }, reason: "target_missing", notCalled: ["realpath", "version", "schema", "dotenv", "listeners", "identity", "prisma:status"] },
    { name: "protected port", stage: "target", config: { url: "postgresql://u:p@127.0.0.1:5432/runlayer_test" }, reason: "protected_port", notCalled: ["realpath", "version", "listeners", "identity", "prisma:status"] },
    { name: "localhost", stage: "target", config: { url: "postgresql://u:p@localhost:54341/runlayer_test" }, reason: "host_not_loopback_literal", notCalled: ["version", "listeners", "identity"] },
    { name: "non-disposable name", stage: "target", config: { url: "postgresql://u:p@127.0.0.1:54341/app_test" }, reason: "database_name_not_disposable", notCalled: ["version", "listeners", "identity"] },
    { name: "missing data directory", stage: "data_directory", config: { dataDirectory: undefined }, reason: "data_dir_missing", notCalled: ["version", "listeners", "identity", "prisma:status"] },
    { name: "relative data directory", stage: "data_directory", config: { dataDirectory: "pg14" }, reason: "data_dir_not_absolute", notCalled: ["version", "listeners", "identity"] },
    { name: "data directory outside the root", stage: "data_directory", config: { dataDirectory: "/usr/local/var/postgres14" }, reason: "data_dir_outside_root", notCalled: ["version", "listeners", "identity"] },
    { name: "missing root", stage: "data_directory", config: { allowedRoot: undefined }, reason: "root_invalid", notCalled: ["version", "listeners", "identity"] },
    { name: "data directory is a symlink or absent", stage: "data_directory", deps: { realpathDirectory: () => "/elsewhere/pg14" }, reason: "data_dir_not_canonical_or_missing", notCalled: ["version", "listeners", "identity"] },
    { name: "data directory does not exist", stage: "data_directory", deps: { realpathDirectory: () => null }, reason: "data_dir_not_canonical_or_missing", notCalled: ["version", "listeners", "identity"] },
    { name: "Prisma 6", stage: "prisma_version", deps: { readPrismaVersion: () => "6.0.0" }, reason: "prisma_version_unsupported", notCalled: ["listeners", "identity", "prisma:status"] },
    { name: "Prisma version unreadable", stage: "prisma_version", deps: { readPrismaVersion: () => null }, reason: "prisma_version_unsupported", notCalled: ["listeners", "identity"] },
    { name: "Prisma version read throws", stage: "prisma_version", deps: { readPrismaVersion: () => { throw new Error("boom"); } }, reason: "prisma_version_unreadable", notCalled: ["listeners", "identity"] },
    { name: "schema unreadable", stage: "port_owner", deps: { readSchemaText: () => { throw new Error("boom"); } }, reason: "configuration_unavailable", notCalled: ["listeners", "identity", "prisma:status"] },
    { name: "server reports another database", stage: "identity", deps: { queryIdentityFacts: async () => ({ currentDatabase: "postgres", serverPort: 54341, serverAddress: "127.0.0.1", dataDirectory: DIR, databases: ["postgres", "runlayer_g1_test_14"], publicTables: [] }) }, reason: "database_name_mismatch", notCalled: ["prisma:status"] },
    { name: "server reports another data directory", stage: "identity", deps: { queryIdentityFacts: async () => ({ currentDatabase: "runlayer_g1_test_14", serverPort: 54341, serverAddress: "127.0.0.1", dataDirectory: "/Users/x/Library/Application Support/Postgres/var-17", databases: ["postgres", "runlayer_g1_test_14"], publicTables: [] }) }, reason: "data_directory_mismatch", notCalled: ["prisma:status"] },
    { name: "server holds other databases", stage: "identity", deps: { queryIdentityFacts: async () => ({ currentDatabase: "runlayer_g1_test_14", serverPort: 54341, serverAddress: "127.0.0.1", dataDirectory: DIR, databases: ["postgres", "runlayer_g1_test_14", "customers"], publicTables: [] }) }, reason: "unexpected_databases_present", notCalled: ["prisma:status"] },
    { name: "unexpected schema contents", stage: "identity", deps: { queryIdentityFacts: async () => ({ currentDatabase: "runlayer_g1_test_14", serverPort: 54341, serverAddress: "127.0.0.1", dataDirectory: DIR, databases: ["postgres", "runlayer_g1_test_14"], publicTables: ["users", "payments"] }) }, reason: "unexpected_schema_contents", notCalled: ["prisma:status"] },
    { name: "identity query rejects", stage: "identity", deps: { queryIdentityFacts: async () => { throw new Error("connection refused"); } }, reason: "identity_query_failed", notCalled: ["prisma:status"] },
    { name: "Prisma cannot start", stage: "prisma_status", runs: { status: { started: false, status: null, output: "" } }, reason: "prisma_not_started", notCalled: [] },
    { name: "Prisma names another database", stage: "prisma_status", runs: { status: { started: true, status: 0, output: UP_TO_DATE.replace("runlayer_g1_test_14", "prod") } }, reason: "prisma_target_database_mismatch", notCalled: [] },
    { name: "Prisma names another port", stage: "prisma_status", runs: { status: { started: true, status: 0, output: UP_TO_DATE.replace("54341", "5432") } }, reason: "prisma_target_address_mismatch", notCalled: [] },
    { name: "Prisma names no target", stage: "prisma_status", runs: { status: { started: true, status: 1, output: "Error: Environment variable not found: DATABASE_URL." } }, reason: "prisma_target_line_missing", notCalled: [] },
    { name: "Prisma reports a problem", stage: "prisma_status", runs: { status: { started: true, status: 1, output: `${UP_TO_DATE}\nP1001 cannot reach` } }, reason: "prisma_output_reports_a_problem", notCalled: [] },
    { name: "Prisma output unrecognized", stage: "prisma_status", runs: { status: { started: true, status: 0, output: 'Datasource "db": PostgreSQL database "runlayer_g1_test_14", schema "public" at "127.0.0.1:54341"\nhello' } }, reason: "prisma_output_unrecognized", notCalled: [] },
    { name: "Prisma status throws", stage: "prisma_status", deps: { runPrisma: () => { throw new Error("spawn failed"); } }, reason: "prisma_status_failed", notCalled: [] },
];

test("a failed prerequisite stops at that stage, skips every later stage, and `migrate deploy` is never reached (execute mode, every gate)", async () => {
    for (const failure of FAILURES) {
        const f = fakes(failure.deps, failure.runs);
        const result = await runDisposableMigration(config({ execute: true, ...failure.config }), f.deps);
        assert.equal(result.ok, false, failure.name);
        assert.ok(!result.ok);
        assert.equal(result.stage, failure.stage, failure.name);
        assert.ok(result.reasons.includes(failure.reason), `${failure.name}: ${result.reasons}`);
        assert.equal(deployCalls(f), 0, `${failure.name}: migrate deploy must never run`);
        assert.equal(f.prisma.filter((entry) => entry.subcommand !== "status").length, 0, failure.name);
        for (const skipped of failure.notCalled) assert.equal(f.calls.includes(skipped), false, `${failure.name}: ${skipped} must not run after the failure`);
        assert.equal(JSON.stringify(result).includes("pw"), false, `${failure.name}: no credential in the result`);
    }
});

test("the stages that completed before a failure are reported, in order", async () => {
    const f = fakes({ listListeners: () => ({ kind: "none" }) });
    const result = await runDisposableMigration(config({ execute: true }), f.deps);
    assert.ok(!result.ok);
    assert.deepEqual(result.completed, ["target", "data_directory", "prisma_version"]);
});

test("a failing `migrate deploy` is reported as a migrate failure; a deploy that cannot start never counts as success", async () => {
    for (const run of [{ started: true, status: 1, output: "" }, { started: true, status: null, output: "" }, { started: false, status: null, output: "" }] as PrismaRun[]) {
        const f = fakes({}, { deploy: run });
        const result = await runDisposableMigration(config({ execute: true }), f.deps);
        assert.ok(!result.ok);
        assert.equal(result.stage, "migrate");
        assert.deepEqual(result.completed.at(-1), "prisma_status");
        assert.equal(deployCalls(f), 1, "never retried");
    }
    const thrown = await runDisposableMigration(config({ execute: true }), fakes({ runPrisma: (inv) => { if (inv.args[2] === "deploy") throw new Error("boom"); return { started: true, status: 0, output: UP_TO_DATE }; } }).deps);
    assert.ok(!thrown.ok && thrown.stage === "migrate" && thrown.reasons.includes("prisma_deploy_failed"));
});

test("an ambient DATABASE_URL or hostile parent environment cannot redirect the verification or the migration", async () => {
    const f = fakes({ parentEnv: { PATH: "/usr/bin", DATABASE_URL: "postgresql://attacker:x@db.example.invalid:5432/prod", NODE_OPTIONS: "--require /evil.js", PGHOST: "db.example.invalid" } });
    const result = await runDisposableMigration(config({ execute: true }), f.deps);
    assert.equal(result.ok, true);
    for (const { invocation } of f.prisma) {
        assert.equal(invocation.env.DATABASE_URL, URL_OK);
        assert.equal(JSON.stringify(invocation.env).includes("example.invalid"), false);
        assert.equal("NODE_OPTIONS" in invocation.env || "PGHOST" in invocation.env, false);
    }
});

// --- Port-owner verification without `ps` -------------------------------------------------------------------------------------------------

type OwnerCase = { name: string; deps: Partial<DisposableDeps>; reason: string };
const unavailable: CommandOutcome = { kind: "unavailable" };
const throwing = () => { throw new Error("EACCES /secret/path postgresql://u:pw@h/db"); };
// Each "listeners" call is answered in order, so a test can describe a change between the first and the second observation.
const sequence = (...outputs: CommandOutcome[]): DisposableDeps["listListeners"] => { let index = 0; return () => outputs[Math.min(index++, outputs.length - 1)] as CommandOutcome; };

const OWNER_CASES: OwnerCase[] = [
    { name: "nothing listening", deps: { listListeners: () => ({ kind: "none" }) }, reason: "port_not_listening" },
    { name: "wrong pid in postmaster.pid (stale file from a dead server)", deps: { readPostmasterPid: () => pidFile(31337) }, reason: "postgres_identity_mismatch" },
    { name: "postmaster.pid absent", deps: { readPostmasterPid: () => null }, reason: "postgres_identity_mismatch" },
    { name: "postmaster.pid names another data directory", deps: { readPostmasterPid: () => pidFile(4242, "/tmp/scratch/g1/other") }, reason: "postgres_identity_mismatch" },
    { name: "postmaster.pid names another port", deps: { readPostmasterPid: () => pidFile(4242, DIR, 5432) }, reason: "postgres_identity_mismatch" },
    { name: "postmaster.pid malformed", deps: { readPostmasterPid: () => "garbage" }, reason: "postgres_identity_mismatch" },
    { name: "pid reuse: the live listener is not the process the file describes", deps: { listListeners: () => ok(listen(777)), readProcessCwd: () => ok(cwdOut(777)) }, reason: "postgres_identity_mismatch" },
    { name: "listener is not named postgres", deps: { listListeners: () => ok(listen(4242, "node")) }, reason: "port_owner_not_postgres" },
    { name: "listener command merely contains postgres", deps: { listListeners: () => ok(listen(4242, "postgres-fake")) }, reason: "port_owner_not_postgres" },
    { name: "two processes listen", deps: { listListeners: () => ok(`${listen(4242)}${listen(4243)}`) }, reason: "port_owner_ambiguous" },
    { name: "wildcard address", deps: { listListeners: () => ok(listen(4242, "postgres", ["*:54341"])) }, reason: "port_listener_address_unexpected" },
    { name: "non-loopback address", deps: { listListeners: () => ok(listen(4242, "postgres", ["192.0.2.7:54341"])) }, reason: "port_listener_address_unexpected" },
    { name: "loopback plus a wildcard on the same pid", deps: { listListeners: () => ok(listen(4242, "postgres", ["127.0.0.1:54341", "*:54341"])) }, reason: "port_listener_address_unexpected" },
    { name: "the target's own address is not among the bound ones", deps: { listListeners: () => ok(listen(4242, "postgres", ["[::1]:54341"])) }, reason: "port_listener_address_unexpected" },
    { name: "bound on another port", deps: { listListeners: () => ok(listen(4242, "postgres", ["127.0.0.1:5432"])) }, reason: "port_listener_address_unexpected" },
    { name: "wrong data directory (cwd of another server)", deps: { readProcessCwd: () => ok(cwdOut(4242, "/Users/x/Library/Application Support/Postgres/var-17")) }, reason: "port_owner_mismatch" },
    { name: "cwd is a prefix of the expected directory", deps: { readProcessCwd: () => ok(cwdOut(4242, ROOT)) }, reason: "port_owner_mismatch" },
    { name: "the listener is replaced between observations", deps: { listListeners: sequence(ok(listen(4242)), ok(listen(9999))) }, reason: "port_owner_changed" },
    { name: "the listener vanishes between observations", deps: { listListeners: sequence(ok(listen(4242)), { kind: "none" }) }, reason: "port_owner_changed" },
    { name: "the listener's address changes between observations", deps: { listListeners: sequence(ok(listen(4242)), ok(listen(4242, "postgres", ["127.0.0.1:54341", "*:54341"]))) }, reason: "port_owner_changed" },
    { name: "the process exits before its cwd is read", deps: { readProcessCwd: () => ({ kind: "none" }) }, reason: "port_owner_changed" },
    { name: "lsof missing or denied (listeners)", deps: { listListeners: () => unavailable }, reason: "port_inspection_unavailable" },
    { name: "lsof missing or denied (cwd)", deps: { readProcessCwd: () => unavailable }, reason: "port_inspection_unavailable" },
    { name: "lsof unavailable on the second observation", deps: { listListeners: sequence(ok(listen(4242)), unavailable) }, reason: "port_inspection_unavailable" },
    { name: "malformed listener output", deps: { listListeners: () => ok("this is not lsof output") }, reason: "port_inspection_unavailable" },
    { name: "listener output with an unknown field", deps: { listListeners: () => ok("p4242\ncpostgres\nxsurprise\nn127.0.0.1:54341\n") }, reason: "port_inspection_unavailable" },
    { name: "listener without an address", deps: { listListeners: () => ok("p4242\ncpostgres\n") }, reason: "port_inspection_unavailable" },
    { name: "malformed cwd output", deps: { readProcessCwd: () => ok("p4242\nfcwd\nnrelative/path\n") }, reason: "port_inspection_unavailable" },
    { name: "cwd output for a different pid", deps: { readProcessCwd: () => ok(cwdOut(1)) }, reason: "port_inspection_unavailable" },
    { name: "listing throws", deps: { listListeners: throwing }, reason: "port_inspection_unavailable" },
    { name: "cwd read throws", deps: { readProcessCwd: throwing }, reason: "port_inspection_unavailable" },
    { name: "postmaster.pid read throws (permission denied)", deps: { readPostmasterPid: throwing }, reason: "port_inspection_unavailable" },
];

test("port-owner verification: a healthy server passes; every wrong, stale, ambiguous or unobservable state is refused at port_owner with a stable code", async () => {
    const healthy = fakes();
    assert.deepEqual(await runDisposableMigration(config(), healthy.deps), { ok: true, mode: "check", completed: ["target", "data_directory", "prisma_version", "port_owner", "identity", "prisma_status"], prismaState: "up_to_date" });
    assert.equal(healthy.calls.filter((call) => call === "listeners").length, 2, "observed twice, to catch replacement");

    for (const ownerCase of OWNER_CASES) {
        const f = fakes(ownerCase.deps);
        const result = await runDisposableMigration(config({ execute: true }), f.deps);
        assert.ok(!result.ok, ownerCase.name);
        assert.equal(result.stage, "port_owner", ownerCase.name);
        assert.ok(result.reasons.includes(ownerCase.reason), `${ownerCase.name}: ${result.reasons}`);
        assert.deepEqual(result.completed, ["target", "data_directory", "prisma_version"], ownerCase.name);
        for (const later of ["identity", "prisma:status", "prisma:deploy"]) assert.equal(f.calls.includes(later), false, `${ownerCase.name}: ${later} must not run`);
        assert.equal(f.prisma.length, 0, `${ownerCase.name}: Prisma is never started, so migrate deploy can never run`);
        assert.equal(/EACCES|secret|pw|postgresql:/.test(JSON.stringify(result)), false, `${ownerCase.name}: no raw error text or credential in the result`);
    }
});

test("port-owner verification never shells out to ps, and refuses outright when the dependency set offers nothing else", async () => {
    // The dependency surface has no process-listing function at all: only lsof-shaped outcomes and a file read.
    const names = Object.keys(fakes().deps).filter((name) => /owner|ps\b|command/i.test(name));
    assert.deepEqual(names, []);
    const f = fakes({ listListeners: () => unavailable, readProcessCwd: () => unavailable, readPostmasterPid: () => null });
    const result = await runDisposableMigration(config(), f.deps);
    assert.ok(!result.ok && result.reasons.length === 1 && result.reasons[0] === "port_inspection_unavailable");
});

test("failure diagnostics are stable codes: no generic `stage_threw` is produced by any stage", async () => {
    const throwers: Array<Partial<DisposableDeps>> = [{ readPrismaVersion: throwing }, { readSchemaText: throwing }, { readDotenvTexts: throwing }, { listListeners: throwing }, { queryIdentityFacts: throwing as never }, { runPrisma: throwing as never }];
    for (const deps of throwers) {
        const result = await runDisposableMigration(config({ execute: true }), fakes(deps).deps);
        assert.ok(!result.ok);
        assert.equal(JSON.stringify(result).includes("stage_threw"), false, JSON.stringify(result));
        assert.equal(/EACCES|secret|postgresql:|pw/.test(JSON.stringify(result)), false, "no untrusted text echoed");
    }
});

// --- Execute-mode behavior matrix (Stage G1-S4) ---------------------------------------------------------------------------------------------
// The orchestration branches on `execute` only, never on the Prisma state. Live evidence (G1-S3C): execute + pending applied 11 migrations;
// check + up_to_date reported up_to_date. Execute + up_to_date has NOT been run live: the wrapper still invokes `migrate deploy` once, which
// Prisma is documented to treat as a no-op. These tests pin the CURRENT, intended behavior with injected dependencies only.

const STATUS_RUNS = { pending: { started: true, status: 1, output: PENDING }, up_to_date: { started: true, status: 0, output: UP_TO_DATE } } as const;

test("behavior matrix: check never deploys; execute deploys exactly once after status, for pending AND up_to_date", async () => {
    for (const state of ["pending", "up_to_date"] as const) {
        const check = fakes({}, { status: STATUS_RUNS[state] });
        assert.deepEqual(await runDisposableMigration(config({ execute: false }), check.deps), { ok: true, mode: "check", completed: ["target", "data_directory", "prisma_version", "port_owner", "identity", "prisma_status"], prismaState: state });
        assert.equal(deployCalls(check), 0, `check + ${state}: deploy must never run`);
        assert.deepEqual(check.prisma.map((entry) => entry.subcommand), ["status"]);

        const execute = fakes({}, { status: STATUS_RUNS[state] });
        assert.deepEqual(await runDisposableMigration(config({ execute: true }), execute.deps), { ok: true, mode: "migrate", completed: ["target", "data_directory", "prisma_version", "port_owner", "identity", "prisma_status", "migrate"], prismaState: state });
        assert.deepEqual(execute.prisma.map((entry) => entry.subcommand), ["status", "deploy"], `execute + ${state}: status first, then exactly one deploy`);
    }
});

test("the deploy invocation is exactly `node <repo prisma CLI> migrate deploy --schema <repo schema>`, differs from status only in the subcommand, and shares one environment", async () => {
    const f = fakes({}, { status: STATUS_RUNS.up_to_date });
    await runDisposableMigration(config({ execute: true }), f.deps);
    const [status, deploy] = f.prisma.map((entry) => entry.invocation) as [DisposableInvocation, DisposableInvocation];
    assert.equal(deploy.command, "/usr/bin/node", "run through node, never npx or a shell");
    assert.deepEqual([...deploy.args], ["/repo/node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "/repo/prisma/schema.prisma"]);
    assert.deepEqual([...status.args], ["/repo/node_modules/prisma/build/index.js", "migrate", "status", "--schema", "/repo/prisma/schema.prisma"]);
    assert.equal(status.env, deploy.env, "the very same environment object");
    assert.equal(status.cwd, deploy.cwd);
    assert.equal(deploy.env.DATABASE_URL, URL_OK);
    assert.equal(deploy.env.SUPABASE_URL, "", "hosted .env keys stay neutralized for the migration too");
    assert.ok(Object.isFrozen(deploy.env) && Object.isFrozen(deploy.args), "nothing can alter the invocation between verification and migration");
    for (const flag of ["reset", "push", "dev", "--force", "--accept-data-loss"]) assert.equal(deploy.args.includes(flag), false, flag);
});

test("an unexpected Prisma status fails closed before deploy in execute mode, in every combination of exit code and wording", async () => {
    const head = 'Datasource "db": PostgreSQL database "runlayer_g1_test_14", schema "public" at "127.0.0.1:54341"\n';
    const unexpected: Array<[string, PrismaRun]> = [
        ["up-to-date text with exit 1", { started: true, status: 1, output: UP_TO_DATE }],
        ["pending text with exit 0", { started: true, status: 0, output: PENDING }],
        ["exit 2", { started: true, status: 2, output: UP_TO_DATE }],
        ["no exit status", { started: true, status: null, output: UP_TO_DATE }],
        ["unknown wording", { started: true, status: 0, output: `${head}All good, probably.` }],
        ["failed migrations reported", { started: true, status: 1, output: `${PENDING}\nFollowing migrations have failed:\n2026_x` }],
        ["drift reported", { started: true, status: 1, output: `${head}Drift detected: Your database schema is not in sync with your migration history.` }],
        ["empty output", { started: true, status: 0, output: "" }],
    ];
    for (const [name, run] of unexpected) {
        const f = fakes({}, { status: run });
        const result = await runDisposableMigration(config({ execute: true }), f.deps);
        assert.ok(!result.ok, name);
        assert.equal(result.stage, "prisma_status", name);
        assert.equal(deployCalls(f), 0, `${name}: deploy must not run`);
        assert.deepEqual(f.prisma.map((entry) => entry.subcommand), ["status"], name);
    }
});

test("a failure at any stage before migration prevents deploy, and the Prisma CLI is not even started before the status gate", async () => {
    const earlier: Array<[string, Partial<DisposableDeps>, Partial<DisposableConfig>]> = [
        ["protected port", {}, { url: "postgresql://u:p@127.0.0.1:5432/runlayer_test" }],
        ["data directory outside the root", {}, { dataDirectory: "/elsewhere/pg" }],
        ["Prisma 6", { readPrismaVersion: () => "6.0.0" }, {}],
        ["port owner unavailable", { listListeners: () => ({ kind: "unavailable" }) }, {}],
        ["identity mismatch", { queryIdentityFacts: async () => ({ currentDatabase: "postgres", serverPort: 54341, serverAddress: "127.0.0.1", dataDirectory: DIR, databases: ["postgres", "runlayer_g1_test_14"], publicTables: [] }) }, {}],
    ];
    for (const [name, deps, over] of earlier) {
        const f = fakes(deps);
        const result = await runDisposableMigration(config({ execute: true, ...over }), f.deps);
        assert.ok(!result.ok, name);
        assert.equal(f.prisma.length, 0, `${name}: Prisma must not start at all`);
        assert.equal(deployCalls(f), 0, name);
    }
});

test("a failed or unstartable deploy is a migrate failure, whatever the prior state, and is never retried", async () => {
    for (const state of ["pending", "up_to_date"] as const) {
        for (const deploy of [{ started: true, status: 1, output: "" }, { started: false, status: null, output: "" }] as PrismaRun[]) {
            const f = fakes({}, { status: STATUS_RUNS[state], deploy });
            const result = await runDisposableMigration(config({ execute: true }), f.deps);
            assert.ok(!result.ok && result.stage === "migrate", `${state}`);
            assert.equal(deployCalls(f), 1, "never retried");
        }
    }
});
