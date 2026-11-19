import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ConnectedIdentityError, evaluateConnectedIdentity, expectedDataDirectoryFromEnv, expectedIdentityFor, verifyConnectedIdentity, type ConnectedFacts, type ExpectedIdentity } from "./connectedIdentity";
import { CHILD_GUARD_PATH, PASSTHROUGH, PrismaChildError, assertScratchUrl, buildChildEnvironment, buildPsqlEnvironment, runPrismaCli, type PrismaRun, type SpawnFunction } from "./prismaChild";
import { MarkerCleanupError, combineFailures, runMarkerCleanup } from "./markerCleanup";
import { ScratchDatabaseError, createScratchDatabaseManager, type ScratchAdmin } from "./scratchDatabase";

// Offline tests for the integration CHILD isolation: the child guard and policy, the single Prisma spawn helper, the scratch-database
// manager, and the connected-database identity check. Nothing here runs Prisma, starts PostgreSQL or opens a database connection. The
// only child processes are `node` running fixtures/child-probe.cjs, which stands in for the Prisma CLI and does nothing.

const requireHere = createRequire(import.meta.url);
const policy = requireHere("./childPolicy.cjs") as typeof import("./childPolicy.cjs");
const target = requireHere("./target.cjs") as typeof import("./target.cjs");
const root = fileURLToPath(new URL("../../", import.meta.url));
const probe = fileURLToPath(new URL("./fixtures/child-probe.cjs", import.meta.url));
const mainGuard = fileURLToPath(new URL("./guard.cjs", import.meta.url));

const BASE = "postgresql://u:pw-secret@127.0.0.1:54329/runlayer_g2_test";
const scratchUrl = (name = "runlayer_g2_test_br_clean_0123abcd", base = BASE) => { const url = new URL(base); url.pathname = `/${name}`; return url.toString(); };
const SCRATCH = scratchUrl();
const WORKDIR = "/tmp/runlayer-br-abc123";
const SCHEMA = `${WORKDIR}/prisma/schema.prisma`;
const DEPLOY = ["migrate", "deploy", "--schema", SCHEMA];
const DIFF_SHADOW = ["migrate", "diff", "--from-migrations", `${WORKDIR}/prisma/migrations`, "--to-schema-datamodel", SCHEMA, "--shadow-database-url", SCRATCH, "--exit-code"];
const DIFF_LIVE = ["migrate", "diff", "--from-url", SCRATCH, "--to-schema-datamodel", SCHEMA, "--exit-code"];
const RESOLVE = ["migrate", "resolve", "--rolled-back", "20261105200000_add_brand_normalized_name", "--schema", SCHEMA];
const PARENT = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };

const SECRETS = /pw-secret|super-secret|127\.0\.0\.1:54329|postgresql:\/\//;

// --- the policy, as a table ------------------------------------------------------------------------------------------------------------

test("the approved Prisma operations are accepted, in any flag order", () => {
    for (const args of [DEPLOY, DIFF_SHADOW, DIFF_LIVE, RESOLVE, ["migrate", "status", "--schema", SCHEMA], ["migrate", "diff", "--exit-code", "--to-schema-datamodel", SCHEMA, "--from-url", SCRATCH]]) {
        assert.deepEqual(policy.checkPrismaArgs(args, { baseUrl: BASE, workdir: WORKDIR }), { ok: true }, args.join(" ").replace(SCRATCH, "<scratch>"));
    }
});

test("unexpected Prisma commands, flags and operands are refused with a code", () => {
    const cases: Array<[string, string[], string]> = [
        ["db push", ["db", "push", "--schema", SCHEMA], "prisma_command_not_allowed"],
        ["migrate reset", ["migrate", "reset", "--schema", SCHEMA], "prisma_command_not_allowed"],
        ["migrate dev", ["migrate", "dev", "--schema", SCHEMA], "prisma_command_not_allowed"],
        ["generate", ["generate", "--schema", SCHEMA], "prisma_command_not_allowed"],
        ["db execute", ["db", "execute", "--file", "/tmp/x.sql", "--schema", SCHEMA], "prisma_command_not_allowed"],
        ["force flag", ["migrate", "deploy", "--schema", SCHEMA, "--force"], "prisma_flag_not_allowed"],
        ["accept-data-loss", ["migrate", "diff", "--from-url", SCRATCH, "--to-schema-datamodel", SCHEMA, "--exit-code", "--accept-data-loss"], "prisma_flag_not_allowed"],
        ["url flag on deploy", ["migrate", "deploy", "--schema", SCHEMA, "--url", SCRATCH], "prisma_flag_not_allowed"],
        ["datasource flag", ["migrate", "deploy", "--datasource", "x"], "prisma_flag_not_allowed"],
        ["repeated schema", ["migrate", "deploy", "--schema", SCHEMA, "--schema", SCHEMA], "prisma_flag_repeated"],
        ["missing schema", ["migrate", "deploy", "--help", "x"], "prisma_flag_not_allowed"],
        ["schema without value", ["migrate", "deploy", "--schema"], "prisma_value_missing"],
        ["relative schema", ["migrate", "deploy", "--schema", "prisma/schema.prisma"], "prisma_path_not_allowed"],
        ["schema outside the workdir", ["migrate", "deploy", "--schema", "/etc/passwd"], "prisma_path_not_allowed"],
        ["parent traversal", ["migrate", "deploy", "--schema", `${WORKDIR}/../elsewhere/schema.prisma`], "prisma_path_not_allowed"],
        ["bad migration name", ["migrate", "resolve", "--rolled-back", "../../x", "--schema", SCHEMA], "prisma_value_invalid"],
        ["rolled-back missing", ["migrate", "resolve", "--schema", SCHEMA], "prisma_flag_missing"],
        ["diff to the base database", ["migrate", "diff", "--from-url", BASE, "--to-schema-datamodel", SCHEMA, "--exit-code"], "prisma_url_not_scratch"],
        ["diff to the 5432 server", ["migrate", "diff", "--from-url", "postgresql://u:pw-secret@127.0.0.1:5432/runlayer_g2_test_br_clean_0123abcd", "--to-schema-datamodel", SCHEMA, "--exit-code"], "prisma_url_not_scratch"],
        ["shadow database on another host", ["migrate", "diff", "--from-migrations", `${WORKDIR}/m`, "--to-schema-datamodel", SCHEMA, "--shadow-database-url", "postgresql://u:pw-secret@db.example.invalid:54329/runlayer_g2_test_br_clean_0123abcd", "--exit-code"], "prisma_url_not_scratch"],
        ["diff without a shadow database", ["migrate", "diff", "--from-migrations", `${WORKDIR}/m`, "--to-schema-datamodel", SCHEMA, "--exit-code"], "prisma_flag_missing"],
        ["diff with both sources", ["migrate", "diff", "--from-url", SCRATCH, "--from-migrations", `${WORKDIR}/m`, "--to-schema-datamodel", SCHEMA, "--shadow-database-url", SCRATCH, "--exit-code"], "prisma_flag_missing"],
        ["live diff with a shadow database", ["migrate", "diff", "--from-url", SCRATCH, "--to-schema-datamodel", SCHEMA, "--shadow-database-url", SCRATCH, "--exit-code"], "prisma_flag_not_allowed"],
        ["too few arguments", ["migrate", "deploy"], "prisma_args_malformed"],
        ["a control character", ["migrate", "deploy", "--schema", `${SCHEMA}\n--force`], "prisma_args_malformed"],
        ["a non-string", ["migrate", "deploy", "--schema", 5 as unknown as string], "prisma_args_malformed"],
    ];
    for (const [label, args, code] of cases) {
        const verdict = policy.checkPrismaArgs(args, { baseUrl: BASE, workdir: WORKDIR });
        assert.deepEqual(verdict.ok ? null : verdict.code, code, label);
        assert.doesNotMatch(JSON.stringify(verdict), SECRETS, `${label}: no URL or credential in the code`);
    }
    assert.equal(policy.checkPrismaArgs(DEPLOY, { baseUrl: "postgresql://u:p@localhost:54329/runlayer_g2_test", workdir: WORKDIR }).ok, false, "an invalid base refuses everything");
});

test("scratch derivation is exact: same host and port, derived name, never the base, and a 63-character limit", () => {
    const scratch = (name: string, base = BASE) => target.checkScratchTarget(base, scratchUrl(name, base));
    assert.equal(scratch("runlayer_g2_test_br_clean_0123abcd").ok, true);
    assert.equal(scratch("runlayer_g2_test_c2_life_00ff00ff").ok, true);
    for (const [name, code] of [
        ["runlayer_g2_test", "scratch_name_not_derived"], ["runlayer_g2_test_br_clean_0123abc", "scratch_name_not_derived"], ["runlayer_g2_test_br_clean_0123ABCD", "scratch_target_invalid"],
        ["runlayer_g2_test_xx_clean_0123abcd", "scratch_name_not_derived"], ["runlayer_other_test_br_clean_0123abcd", "scratch_name_not_derived"], ["postgres", "scratch_target_invalid"],
        ["runlayer_g2_test_br_clean_0123abcd_extra", "scratch_name_not_derived"], ["runlayer_g2_test_br__0123abcd", "scratch_target_invalid"], [`runlayer_g2_test_br_${"a".repeat(12)}_0123abcd_${"b".repeat(30)}`, "scratch_target_invalid"],
    ] as const) assert.deepEqual(scratch(name), { ok: false, code }, name);
    for (const url of ["postgresql://u:pw-secret@127.0.0.2:54329/runlayer_g2_test_br_clean_0123abcd", "postgresql://u:pw-secret@127.0.0.1:54330/runlayer_g2_test_br_clean_0123abcd", "postgresql://u:pw-secret@127.0.0.1:5432/runlayer_g2_test_br_clean_0123abcd", "postgresql://u:pw-secret@localhost:54329/runlayer_g2_test_br_clean_0123abcd", "postgresql://other:pw-secret@127.0.0.1:54329/runlayer_g2_test_br_clean_0123abcd", "postgresql://u:other@127.0.0.1:54329/runlayer_g2_test_br_clean_0123abcd", "postgresql://u:pw-secret@127.0.0.1:54329/runlayer_g2_test_br_clean_0123abcd?connect_timeout=5"]) {
        assert.equal(target.checkScratchTarget(BASE, url).ok, false, url.replace(/:pw-secret@/, ":<>@"));
    }
    assert.equal(target.scratchDatabaseName("runlayer_g2_test", "br", "clean", "0123abcd").ok, true);
    for (const args of [["app_test", "br", "clean", "0123abcd"], ["runlayer_g2_test", "zz", "clean", "0123abcd"], ["runlayer_g2_test", "br", "Clean", "0123abcd"], ["runlayer_g2_test", "br", "clean", "0123ABCD"], ["runlayer_g2_test", "br", "clean", "xyz"], ["runlayer_g2_test", "br", "a".repeat(13), "0123abcd"], [`runlayer_${"a".repeat(40)}_test`, "br", "a".repeat(12), "0123abcd"]] as const) {
        assert.equal(target.scratchDatabaseName(args[0], args[1], args[2], args[3]).ok, false, args.join("/"));
    }
});

test("the child environment must opt in, carry the exact NODE_OPTIONS, and hold no other connection variable", () => {
    const good = buildChildEnvironment({ baseUrl: BASE, databaseUrl: SCRATCH }, PARENT);
    assert.equal(policy.checkChildEnvironment(good, CHILD_GUARD_PATH).ok, true);
    const without = (name: string) => { const copy: Record<string, string | undefined> = { ...good }; delete copy[name]; return copy; };
    const cases: Array<[string, Record<string, string | undefined>, string]> = [
        ["no opt-in", without("RUNLAYER_CHILD_ISOLATION"), "child_opt_in_missing"],
        ["wrong opt-in value", { ...good, RUNLAYER_CHILD_ISOLATION: "1" }, "child_opt_in_missing"],
        ["no NODE_OPTIONS", without("NODE_OPTIONS"), "child_node_options_unexpected"],
        ["extra --require", { ...good, NODE_OPTIONS: `${good.NODE_OPTIONS} --require /tmp/evil.js` }, "child_node_options_unexpected"],
        ["a different preload", { ...good, NODE_OPTIONS: `--require ${JSON.stringify(mainGuard)}` }, "child_node_options_unexpected"],
        ["injected --import", { ...good, NODE_OPTIONS: `--import /tmp/evil.mjs ${good.NODE_OPTIONS}` }, "child_node_options_unexpected"],
        ["no base", without("RUNLAYER_TEST_DATABASE_URL"), "base_target_invalid"],
        ["no scratch", without("DATABASE_URL"), "scratch_target_invalid"],
        ["DATABASE_URL is the base itself", { ...good, DATABASE_URL: BASE }, "scratch_name_not_derived"],
        ["DATABASE_URL is a hosted URL", { ...good, DATABASE_URL: "postgresql://attacker:x@db.example.invalid:5432/prod" }, "scratch_target_invalid"],
        ["base on port 5432", { ...good, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:pw-secret@127.0.0.1:5432/runlayer_g2_test" }, "base_target_invalid"],
        ["base on localhost", { ...good, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:pw-secret@localhost:54329/runlayer_g2_test" }, "base_target_invalid"],
        ["PGHOST", { ...good, PGHOST: "db.example.invalid" }, "child_connection_variable_present"],
        ["DIRECT_URL", { ...good, DIRECT_URL: "postgresql://a:b@h.example.invalid/x" }, "child_connection_variable_present"],
        ["SHADOW_DATABASE_URL", { ...good, SHADOW_DATABASE_URL: SCRATCH }, "child_connection_variable_present"],
        ["SUPABASE_URL", { ...good, SUPABASE_URL: "https://p.example.invalid" }, "child_connection_variable_present"],
        ["a wrapper variable", { ...good, RUNLAYER_DISPOSABLE_URL: BASE }, "child_connection_variable_present"],
    ];
    for (const [label, env, code] of cases) {
        const verdict = policy.checkChildEnvironment(env, CHILD_GUARD_PATH);
        assert.deepEqual(verdict.ok ? null : verdict.code, code, label);
        assert.doesNotMatch(JSON.stringify(verdict), SECRETS, label);
    }
    assert.equal(policy.checkChildEnvironment({ ...good, PGHOST: "" }, CHILD_GUARD_PATH).ok, true, "a connection variable that is defined but EMPTY is harmless");
});

// --- the child guard, end to end in a harmless child process -------------------------------------------------------------------------------

function runProbe(env: Record<string, string | undefined>, args: string[] = DEPLOY) {
    const clean = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string>;
    const result = spawnSync(process.execPath, [probe, ...args], { cwd: root, env: clean as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 30_000 });
    const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const line = /REPORT (.*)/.exec(result.stdout ?? "");
    return { status: result.status, text, report: line ? (JSON.parse(line[1] as string) as Record<string, unknown>) : null, code: /child isolation: ([a-z_]+)/.exec(text)?.[1] ?? null };
}
const childEnv = (over: Record<string, string | undefined> = {}) => ({ ...buildChildEnvironment({ baseUrl: BASE, databaseUrl: SCRATCH }, PARENT), ...over });

test("an approved integration child starts, sees only its scratch target, and keeps loopback-only Node networking", () => {
    const result = runProbe(childEnv());
    assert.equal(result.status, 0, result.text);
    assert.deepEqual(result.report, { key: "127.0.0.1:54329/runlayer_g2_test_br_clean_0123abcd", databasePort: "54329", mainGuardLoaded: false, externalBlocked: true, hostnameBlocked: true, dnsBlocked: true, fetchBlocked: true, loopbackAllowed: true });
    for (const args of [DIFF_SHADOW, DIFF_LIVE, RESOLVE]) assert.equal(runProbe(childEnv(), args.map((arg) => arg.replace(WORKDIR, "/tmp/runlayer-br-abc123"))).status, 0);
});

test("the main guard is unchanged: any process it loads into still gets the unreachable sentinel DATABASE_URL, and it is not the child guard", () => {
    const script = "console.log('REPORT '+JSON.stringify({ port: new URL(process.env.DATABASE_URL).port, child: Boolean(globalThis.__RUNLAYER_CHILD_ISOLATION__), main: Boolean(globalThis.__RUNLAYER_TEST_ISOLATION__) }))";
    const result = spawnSync(process.execPath, ["--require", mainGuard, "-e", script], { cwd: root, env: { ...PARENT, DATABASE_URL: SCRATCH } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
    assert.deepEqual(JSON.parse(/REPORT (.*)/.exec(result.stdout)![1] as string), { port: "1", child: false, main: true }, "an explicit DATABASE_URL is still replaced by the sentinel");
});

test("the child guard refuses every unexpected configuration before the CLI runs, with a code and no URL or credential", () => {
    const good = childEnv();
    const cases: Array<[string, Record<string, string | undefined>, string[], string]> = [
        ["missing opt-in", { ...good, RUNLAYER_CHILD_ISOLATION: undefined }, DEPLOY, "child_opt_in_missing"],
        ["ambient NODE_OPTIONS injection", { ...good, NODE_OPTIONS: `${good.NODE_OPTIONS} --require /tmp/never-loaded.js` }, DEPLOY, "child_node_options_unexpected"],
        ["wrong host", { ...good, DATABASE_URL: "postgresql://u:pw-secret@localhost:54329/runlayer_g2_test_br_clean_0123abcd" }, DEPLOY, "scratch_target_invalid"],
        ["protected port", { ...good, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:pw-secret@127.0.0.1:5432/runlayer_g2_test", DATABASE_URL: "postgresql://u:pw-secret@127.0.0.1:5432/runlayer_g2_test_br_clean_0123abcd" }, DEPLOY, "base_target_invalid"],
        ["pooler port", { ...good, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:pw-secret@127.0.0.1:6543/runlayer_g2_test", DATABASE_URL: "postgresql://u:pw-secret@127.0.0.1:6543/runlayer_g2_test_br_clean_0123abcd" }, DEPLOY, "base_target_invalid"],
        ["wrong base database", { ...good, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:pw-secret@127.0.0.1:54329/production" }, DEPLOY, "base_target_invalid"],
        ["wrong scratch database (the base itself)", { ...good, DATABASE_URL: BASE }, DEPLOY, "scratch_name_not_derived"],
        ["wrong scratch naming", { ...good, DATABASE_URL: scratchUrl("runlayer_g2_test_zz_clean_0123abcd") }, DEPLOY, "scratch_name_not_derived"],
        ["arbitrary DATABASE_URL injection", { ...good, DATABASE_URL: "postgresql://attacker:x@db.example.invalid:5432/prod" }, DEPLOY, "scratch_target_invalid"],
        ["hosted environment variable", { ...good, SUPABASE_URL: "https://p.example.invalid" }, DEPLOY, "child_connection_variable_present"],
        ["PG variable", { ...good, PGHOST: "db.example.invalid" }, DEPLOY, "child_connection_variable_present"],
        ["unexpected Prisma command", good, ["db", "push", "--schema", SCHEMA], "prisma_command_not_allowed"],
        ["unexpected Prisma flag", good, [...DEPLOY, "--force"], "prisma_flag_not_allowed"],
        ["a URL operand that is not a scratch database", good, ["migrate", "diff", "--from-url", BASE, "--to-schema-datamodel", SCHEMA, "--exit-code"], "prisma_url_not_scratch"],
    ];
    for (const [label, env, args, code] of cases) {
        const result = runProbe(env, args);
        assert.notEqual(result.status, 0, `${label}: the child must not start`);
        assert.equal(result.report, null, `${label}: nothing ran`);
        assert.equal(result.code, code, `${label}\n${result.text.slice(0, 300)}`);
        assert.doesNotMatch(result.text, SECRETS, `${label}: no URL or credential in the diagnostics`);
    }
});

// --- the single spawn helper, with an injected spawn ---------------------------------------------------------------------------------------

type Call = { command: string; args: string[]; options: Parameters<SpawnFunction>[2] };
function fakeSpawn(result: Partial<ReturnType<SpawnFunction>> = {}) {
    const calls: Call[] = [];
    const spawn: SpawnFunction = (command, args, options) => { calls.push({ command, args, options }); return { status: 0, stdout: "ok", stderr: "", ...result }; };
    return { calls, spawn };
}
const run = (over: Partial<PrismaRun> = {}): PrismaRun => ({ baseUrl: BASE, databaseUrl: SCRATCH, workdir: WORKDIR, args: DEPLOY, ...over });
const HOSTILE_PARENT = { ...PARENT, DATABASE_URL: "postgresql://attacker:x@db.example.invalid:5432/prod", DIRECT_URL: "postgresql://a:b@d.example.invalid/x", PGHOST: "pg.example.invalid", SUPABASE_URL: "https://p.example.invalid", NODE_OPTIONS: "--require /tmp/evil.js", PRISMA_ENGINES_MIRROR: "https://mirror.example.invalid", HTTPS_PROXY: "http://proxy.example.invalid", RUNLAYER_ALLOW_DB_TESTS: "1", RUNLAYER_DISPOSABLE_URL: BASE, WEATHER_API_KEY: "k" };

test("the spawn helper runs the local CLI with a fixed allowlisted environment, the exact child-guard preload, no shell and a finite timeout", () => {
    const { calls, spawn } = fakeSpawn({ stdout: "out", stderr: "err" });
    const result = runPrismaCli(run(), { spawn, cliPath: "/repo/node_modules/prisma/build/index.js", parentEnv: HOSTILE_PARENT });
    assert.deepEqual(result, { status: 0, output: "out\nerr" });
    assert.equal(calls.length, 1);
    const [call] = calls as [Call];
    assert.equal(call.command, process.execPath);
    assert.deepEqual(call.args, ["/repo/node_modules/prisma/build/index.js", ...DEPLOY]);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.cwd, WORKDIR);
    assert.ok(call.options.timeout > 0 && call.options.timeout <= 600_000);
    assert.deepEqual(Object.keys(call.options.env).sort(), ["CHECKPOINT_DISABLE", "DATABASE_URL", "HOME", "NODE_OPTIONS", "PATH", "PRISMA_HIDE_UPDATE_MESSAGE", "RUNLAYER_CHILD_ISOLATION", "RUNLAYER_TEST_DATABASE_URL"].sort(), "exactly the allowlist, nothing spread from process.env");
    assert.equal(call.options.env.NODE_OPTIONS, `--require ${JSON.stringify(CHILD_GUARD_PATH)}`);
    assert.equal(call.options.env.DATABASE_URL, SCRATCH);
    assert.equal(call.options.env.RUNLAYER_TEST_DATABASE_URL, BASE);
    assert.equal(JSON.stringify(call.options.env).includes("example.invalid"), false, "no hosted or proxy value from the parent reaches the child");
    assert.ok(Object.isFrozen(call.options.env) || Object.keys(call.options.env).length > 0);
    assert.deepEqual([...PASSTHROUGH], ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]);
});

test("the spawn helper validates every target and argument BEFORE spawning", () => {
    const bad: Array<[string, Partial<PrismaRun>, string]> = [
        ["base on localhost", { baseUrl: "postgresql://u:pw-secret@localhost:54329/runlayer_g2_test" }, "base_target_invalid"],
        ["base on 5432", { baseUrl: "postgresql://u:pw-secret@127.0.0.1:5432/runlayer_g2_test" }, "base_target_invalid"],
        ["base on 6543", { baseUrl: "postgresql://u:pw-secret@127.0.0.1:6543/runlayer_g2_test" }, "base_target_invalid"],
        ["base not disposable", { baseUrl: "postgresql://u:pw-secret@127.0.0.1:54329/production" }, "base_target_invalid"],
        ["scratch is the base", { databaseUrl: BASE }, "scratch_name_not_derived"],
        ["scratch on another port", { databaseUrl: "postgresql://u:pw-secret@127.0.0.1:54330/runlayer_g2_test_br_clean_0123abcd" }, "scratch_host_port_mismatch"],
        ["scratch wrongly named", { databaseUrl: scratchUrl("runlayer_g2_test_zz_clean_0123abcd") }, "scratch_name_not_derived"],
        ["relative workdir", { workdir: "tmp/work" }, "workdir_invalid"],
        ["non-canonical workdir", { workdir: "/tmp/a/../b" }, "workdir_invalid"],
        ["db push", { args: ["db", "push", "--schema", SCHEMA] }, "prisma_command_not_allowed"],
        ["migrate reset", { args: ["migrate", "reset", "--schema", SCHEMA] }, "prisma_command_not_allowed"],
        ["schema outside the workdir", { args: ["migrate", "deploy", "--schema", "/etc/schema.prisma"] }, "prisma_path_not_allowed"],
        ["bad timeout", { timeoutMs: 5 }, "timeout_invalid"],
    ];
    for (const [label, over, code] of bad) {
        const { calls, spawn } = fakeSpawn();
        assert.throws(() => runPrismaCli(run(over), { spawn, cliPath: "/repo/cli.js" }), (error: unknown) => error instanceof PrismaChildError && error.code === code && !SECRETS.test(error.message), label);
        assert.equal(calls.length, 0, `${label}: nothing may be spawned`);
    }
    assert.throws(() => runPrismaCli(run(), { spawn: fakeSpawn().spawn, cliPath: "relative/cli.js" }), (error: unknown) => error instanceof PrismaChildError && error.code === "cli_path_invalid");
});

test("a failed Prisma child fails closed: spawn errors, timeouts, signals and malformed output throw; a non-zero exit is reported; nothing is retried", () => {
    const failures: Array<[string, Partial<ReturnType<SpawnFunction>>, string]> = [
        ["spawn error", { status: null, error: new Error("ENOENT postgresql://u:pw-secret@127.0.0.1:54329/x") }, "prisma_child_failed_to_run"],
        ["timeout", { status: null, error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }) }, "prisma_child_failed_to_run"],
        ["killed by a signal", { status: null, signal: "SIGKILL" }, "prisma_child_signalled"],
        ["no exit status", { status: null }, "prisma_child_status_invalid"],
        ["out-of-range status", { status: 300 }, "prisma_child_status_invalid"],
        ["non-integer status", { status: 1.5 }, "prisma_child_status_invalid"],
        ["no stdout", { stdout: null }, "prisma_child_output_malformed"],
        ["binary stderr", { stderr: Buffer.from("x") }, "prisma_child_output_malformed"],
    ];
    for (const [label, result, code] of failures) {
        const { calls, spawn } = fakeSpawn(result);
        assert.throws(() => runPrismaCli(run(), { spawn, cliPath: "/repo/cli.js" }), (error: unknown) => error instanceof PrismaChildError && error.code === code && !SECRETS.test(error.message), label);
        assert.equal(calls.length, 1, `${label}: never retried`);
    }
    for (const status of [1, 2, 7]) assert.equal(runPrismaCli(run(), { spawn: fakeSpawn({ status, stdout: "P3009" }).spawn, cliPath: "/repo/cli.js" }).status, status, "an expected non-zero exit is the caller's to assert on");
    const { output } = runPrismaCli(run(), { spawn: fakeSpawn({ stdout: "see postgresql://u:pw-secret@127.0.0.1:54329/runlayer_g2_test failed" }).spawn, cliPath: "/repo/cli.js" });
    assert.doesNotMatch(output, SECRETS, "URLs are redacted from the output the tests see");
});

test("the psql environment is an allowlist too: no hosted, PG* or proxy variable, only the password", () => {
    const env = buildPsqlEnvironment("pw-secret", HOSTILE_PARENT) as Record<string, string>;
    assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH", "PGPASSWORD"]);
    assert.doesNotThrow(() => assertScratchUrl(BASE, SCRATCH));
    assert.throws(() => assertScratchUrl(BASE, BASE), PrismaChildError);
    assert.throws(() => assertScratchUrl(BASE, "postgresql://u:pw-secret@127.0.0.1:5432/runlayer_g2_test_br_clean_0123abcd"), PrismaChildError);
});

// --- scratch creation and cleanup ------------------------------------------------------------------------------------------------------------

const SUFFIX = "0123abcd";
function fakeAdmin(over: { present?: string[]; failDrop?: string[]; failList?: boolean; failCreate?: boolean } = {}) {
    const log: string[] = [];
    const present = new Set(over.present ?? ["postgres", "runlayer_g2_test"]);
    const admin: ScratchAdmin = {
        execute: async (sql) => {
            log.push(sql);
            const created = /^CREATE DATABASE "([^"]+)"$/.exec(sql);
            const dropped = /^DROP DATABASE IF EXISTS "([^"]+)" WITH \(FORCE\)$/.exec(sql);
            if (created) { if (over.failCreate) throw new Error("create failed"); present.add(created[1] as string); }
            else if (dropped) { if (over.failDrop?.includes(dropped[1] as string)) throw new Error("drop failed"); present.delete(dropped[1] as string); }
            else throw new Error(`unexpected statement: ${sql}`);
        },
        listDatabases: async () => { if (over.failList) throw new Error("list failed"); return [...present]; },
    };
    return { admin, log, present };
}
function manager(admin: ScratchAdmin, verify: () => Promise<void> = async () => {}, kind: "br" | "c2" = "br") {
    const verifications = { count: 0 };
    return { manager: createScratchDatabaseManager({ baseDatabase: "runlayer_g2_test", kind, suffix: SUFFIX, admin, verifyIdentity: async () => { verifications.count += 1; await verify(); } }), verifications };
}

test("scratch creation validates the exact name and the live server identity BEFORE any CREATE DATABASE", async () => {
    const { admin, log } = fakeAdmin();
    const { manager: scratch, verifications } = manager(admin);
    assert.equal(await scratch.create("clean"), `runlayer_g2_test_br_clean_${SUFFIX}`);
    assert.deepEqual(log, [`CREATE DATABASE "runlayer_g2_test_br_clean_${SUFFIX}"`]);
    assert.equal(verifications.count, 1);
    for (const label of ["", "Clean", "has space", 'x"; DROP DATABASE runlayer_g2_test; --', "a".repeat(13), "../x"]) {
        await assert.rejects(() => scratch.create(label), (error: unknown) => error instanceof ScratchDatabaseError && /^scratch_label_invalid$/.test(error.code), label);
    }
    await assert.rejects(() => scratch.create("clean"), (error: unknown) => error instanceof ScratchDatabaseError && error.code === "scratch_name_reused");
    assert.equal(log.length, 1, "no further statement was sent");

    const unverified = fakeAdmin();
    const refusing = manager(unverified.admin, async () => { throw new ConnectedIdentityError(["identity_port_mismatch"]); });
    await assert.rejects(() => refusing.manager.create("clean"), ConnectedIdentityError);
    assert.deepEqual(unverified.log, [], "an unverified server is never sent CREATE DATABASE");
    assert.deepEqual(refusing.manager.created, []);
});

test("scratch creation tracks only what was actually created, and a failed CREATE authorizes nothing", async () => {
    const failing = fakeAdmin({ failCreate: true });
    const { manager: scratch } = manager(failing.admin);
    await assert.rejects(() => scratch.create("clean"), /create failed/);
    assert.deepEqual(scratch.created, []);
    const report = await scratch.cleanup();
    assert.deepEqual(failing.log.filter((sql) => sql.startsWith("DROP")), [], "nothing is dropped for a database that was never created");
    assert.deepEqual(report, { dropped: [], failed: [], leftovers: [] });
});

test("cleanup drops ONLY this run's own databases, by exact name, in reverse order, after re-verifying the server", async () => {
    const other = `runlayer_g2_test_br_other_${SUFFIX.replace("0", "9")}`;
    const stranger = "runlayer_g2_test_br_old_deadbeef";
    const { admin, log, present } = fakeAdmin({ present: ["postgres", "runlayer_g2_test", other, stranger, "customers"] });
    const { manager: scratch, verifications } = manager(admin);
    await scratch.create("clean");
    await scratch.create("shadow");
    const before = verifications.count;
    await scratch.finish();
    assert.equal(verifications.count, before + 1, "identity is re-verified before any DROP");
    assert.deepEqual(log.slice(2), [`DROP DATABASE IF EXISTS "runlayer_g2_test_br_shadow_${SUFFIX}" WITH (FORCE)`, `DROP DATABASE IF EXISTS "runlayer_g2_test_br_clean_${SUFFIX}" WITH (FORCE)`]);
    assert.deepEqual([...present].sort(), ["customers", "postgres", "runlayer_g2_test", other, stranger].sort(), "the base database and every database not created in this run are untouched");
});

test("a manager that never sent a statement does not touch the server at all (no verification, no DROP, no listing)", async () => {
    const lookalike = `runlayer_g2_test_br_pre_${SUFFIX}`;
    const { admin, log } = fakeAdmin({ present: ["postgres", "runlayer_g2_test", lookalike] });
    let listed = 0;
    const counting: ScratchAdmin = { execute: admin.execute, listDatabases: async () => { listed += 1; return admin.listDatabases(); } };
    const { manager: scratch, verifications } = manager(counting);
    assert.deepEqual(await scratch.cleanup(), { dropped: [], failed: [], leftovers: [] });
    await scratch.finish();
    assert.deepEqual(log, []);
    assert.equal(verifications.count, 0);
    assert.equal(listed, 0);
});

test("cleanup of a database NOT created in this run is never attempted, even if it matches this run's naming; it is reported as a leftover", async () => {
    const lookalike = `runlayer_g2_test_br_pre_${SUFFIX}`;
    const { admin, log } = fakeAdmin({ present: ["postgres", "runlayer_g2_test", lookalike] });
    const { manager: scratch } = manager(admin);
    await scratch.create("clean");
    const report = await scratch.cleanup();
    assert.deepEqual(log.filter((sql) => sql.startsWith("DROP")), [`DROP DATABASE IF EXISTS "runlayer_g2_test_br_clean_${SUFFIX}" WITH (FORCE)`], "only the database this run created is dropped");
    assert.deepEqual(report.leftovers, [lookalike]);
    await assert.rejects(() => scratch.finish(), (error: unknown) => error instanceof ScratchDatabaseError && error.code === "scratch_cleanup_incomplete" && error.names.includes(lookalike));
    assert.equal(log.filter((sql) => sql.includes(lookalike)).length, 0, "the look-alike was never touched");
});

test("the base database can never be dropped through scratch cleanup, even if the bookkeeping is tampered with", async () => {
    const { admin, log } = fakeAdmin();
    const { manager: scratch } = manager(admin);
    await scratch.create("clean");
    (scratch.created as string[]).push("runlayer_g2_test", "postgres", "customers");
    const report = await scratch.cleanup();
    assert.deepEqual(log.filter((sql) => sql.startsWith("DROP")), [`DROP DATABASE IF EXISTS "runlayer_g2_test_br_clean_${SUFFIX}" WITH (FORCE)`], "the returned list is a copy; only the real scratch database is dropped");
    assert.equal(report.failed.length, 0);
    assert.equal(target.isScratchDatabaseName("runlayer_g2_test", "runlayer_g2_test"), false);
    for (const name of ["postgres", "customers", "runlayer_g2_test_br_clean", "runlayer_g2_test_br_clean_0123abcd; DROP DATABASE x"]) assert.equal(target.isScratchDatabaseName("runlayer_g2_test", name, SUFFIX), false, name);
});

async function unverifiedCleanup(labels: string[]) {
    const { admin, log } = fakeAdmin();
    let healthy = true;
    let listed = 0;
    const watched: ScratchAdmin = { execute: admin.execute, listDatabases: async () => { listed += 1; return admin.listDatabases(); } };
    const { manager: scratch } = manager(watched, async () => { if (!healthy) throw new ConnectedIdentityError(["identity_data_directory_mismatch", "identity_port_mismatch"]); });
    for (const label of labels) await scratch.create(label);
    healthy = false;
    const error = await scratch.finish().then(() => null, (thrown: unknown) => thrown);
    return { error, log, listed, scratch };
}

test("F3: an identity failure during cleanup sends NO DROP and NO listing, reports the exact tracked names, and preserves the original identity failure", async () => {
    for (const labels of [["clean"], ["clean", "shadow", "life"]]) {
        const { error, log, listed, scratch } = await unverifiedCleanup(labels);
        assert.ok(error instanceof ScratchDatabaseError, "a scratch error, not a bare identity error");
        assert.equal(error.code, "scratch_cleanup_unverified");
        const tracked = labels.map((label) => `runlayer_g2_test_br_${label}_${SUFFIX}`);
        assert.deepEqual([...error.names], tracked, "exactly the databases this run created and still tracks");
        for (const name of tracked) assert.ok(error.message.includes(name), name);
        assert.ok(error.cause instanceof ConnectedIdentityError, "the original identity failure is preserved as the cause");
        assert.deepEqual([...(error.cause as ConnectedIdentityError).reasons], ["identity_data_directory_mismatch", "identity_port_mismatch"]);
        assert.match(error.message, /\[identity: identity_data_directory_mismatch, identity_port_mismatch\]/, "its sanitized reason codes are in the message");
        assert.match(error.message, /no DROP was sent/);
        assert.deepEqual(log.filter((sql) => sql.startsWith("DROP")), [], "no DROP was sent to the unverified server");
        assert.equal(listed, 0, "the unverified server was not even listed");
        assert.deepEqual(scratch.created, tracked, "the tracked list is unchanged");
        assert.doesNotMatch(error.message, SECRETS, "no URL or credential");
    }
});

test("F3: an identity failure during cleanup with NOTHING tracked is a no-op, not an error and not a broader search", async () => {
    const { error, log, listed } = await unverifiedCleanup([]);
    assert.equal(error, null);
    assert.deepEqual(log, []);
    assert.equal(listed, 0);
});

test("F3: a CREATE that was sent but failed is still reported when the server then fails verification (nothing is guessed or dropped)", async () => {
    const { admin, log } = fakeAdmin({ failCreate: true });
    let healthy = true;
    const { manager: scratch } = manager(admin, async () => { if (!healthy) throw new ConnectedIdentityError(["identity_port_mismatch"]); });
    await assert.rejects(() => scratch.create("clean"), /create failed/);
    healthy = false;
    const error = await scratch.finish().then(() => null, (thrown: unknown) => thrown);
    assert.ok(error instanceof ScratchDatabaseError && error.code === "scratch_cleanup_unverified");
    assert.deepEqual([...error.names], [], "nothing was confirmed as created");
    assert.match(error.message, /1 CREATE statement\(s\) were sent, 0 confirmed/);
    assert.match(error.message, new RegExp(`runlayer_g2_test_br_<label>_${SUFFIX}`), "the naming pattern is described for a person; it is never executed");
    assert.deepEqual(log.filter((sql) => sql.startsWith("DROP")), []);
});

test("F3: a cleanup failure AFTER a successful identity check is reported with the failing names and does not hide the test's own failure", async () => {
    const { admin } = fakeAdmin({ failDrop: [`runlayer_g2_test_br_shadow_${SUFFIX}`] });
    const { manager: scratch } = manager(admin);
    await scratch.create("clean");
    await scratch.create("shadow");
    const cleanupError = await scratch.finish().then(() => null, (thrown: unknown) => thrown);
    assert.ok(cleanupError instanceof ScratchDatabaseError && cleanupError.code === "scratch_cleanup_incomplete");
    assert.deepEqual([...cleanupError.names], [`runlayer_g2_test_br_shadow_${SUFFIX}`]);

    const testFailure = new assert.AssertionError({ message: "expected the migration to be refused" });
    const combined = combineFailures(testFailure, cleanupError);
    assert.ok(combined instanceof AggregateError);
    assert.deepEqual(combined.errors, [testFailure, cleanupError], "both originals are preserved");
    assert.match(combined.message, /^expected the migration to be refused\n--- the cleanup ALSO failed: scratch_cleanup_incomplete/, "the test failure comes first");
    assert.equal(combineFailures(undefined, cleanupError), cleanupError, "with no test failure the cleanup failure is reported as is");
});

// --- marker cleanup (the outfit, import, gear and session suites) -----------------------------------------------------------------------

function markerHarness(verify: () => Promise<void>, over: { failing?: number[] } = {}) {
    const events: string[] = [];
    const deletions = ["users", "gear", "brands"].map((name, index) => async () => { events.push(`delete:${name}`); if (over.failing?.includes(index)) throw new Error(`delete ${name} failed postgresql://u:pw-secret@127.0.0.1:54329/x`); });
    return { events, run: (verified: boolean) => runMarkerCleanup({ marker: "p2b-0123abcd", verified, verify: async () => { events.push("verify"); await verify(); }, deletions }) };
}

test("F4: marker cleanup re-verifies the server and only then deletes, in order, by the suite's own deletions", async () => {
    const { events, run } = markerHarness(async () => {});
    assert.equal(await run(true), "cleaned");
    assert.deepEqual(events, ["verify", "delete:users", "delete:gear", "delete:brands"]);
});

test("F4: if the server fails verification at cleanup time NOTHING is deleted, and the refusal is reported explicitly with the marker and the original reasons", async () => {
    for (const patch of [{ port: 5432 }, { db: "postgres" }, { addr: "192.0.2.7" }, { dataDirectory: "/Users/x/Library/Application Support/Postgres/var-17" }]) {
        const { events, run } = markerHarness(() => verifyConnectedIdentity(async () => ({ ...FACTS, ...patch }), EXPECTED));
        const error = await run(true).then(() => null, (thrown: unknown) => thrown);
        assert.ok(error instanceof MarkerCleanupError && error.code === "marker_cleanup_refused", JSON.stringify(patch));
        assert.equal(error.marker, "p2b-0123abcd");
        assert.ok(error.cause instanceof ConnectedIdentityError, "the original identity failure is preserved");
        assert.match(error.message, /no DELETE was sent/);
        assert.match(error.message, /\[identity: identity_[a-z_]+\]/);
        assert.deepEqual(events, ["verify"], `no deletion may run: ${JSON.stringify(patch)}`);
        assert.doesNotMatch(error.message, SECRETS);
    }
});

test("F4: a suite that never verified the server writes nothing and deletes nothing, and does not even contact it", async () => {
    const { events, run } = markerHarness(async () => { throw new Error("must not be called"); });
    assert.equal(await run(false), "nothing_to_clean");
    assert.deepEqual(events, []);
});

test("F4: a failing deletion is reported (count and marker only), the other deletions are still attempted, and the test's own failure is kept", async () => {
    const { events, run } = markerHarness(async () => {}, { failing: [1] });
    const error = await run(true).then(() => null, (thrown: unknown) => thrown);
    assert.ok(error instanceof MarkerCleanupError && error.code === "marker_cleanup_failed");
    assert.deepEqual(events, ["verify", "delete:users", "delete:gear", "delete:brands"], "every deletion was attempted; none was widened");
    assert.match(error.message, /1 of 3 deletion\(s\) failed/);
    assert.doesNotMatch(error.message, SECRETS, "the cause's text is not copied into the message");
    const combined = combineFailures(new Error("the suite's own assertion failed"), error);
    assert.ok(combined instanceof AggregateError && combined.errors.length === 2 && /^the suite's own assertion failed/.test(combined.message));
});

test("a cleanup failure is reported, never swallowed, and does not stop the other drops or widen the deletion", async () => {
    const { admin, log } = fakeAdmin({ failDrop: [`runlayer_g2_test_br_shadow_${SUFFIX}`] });
    const { manager: scratch } = manager(admin);
    await scratch.create("clean");
    await scratch.create("shadow");
    const report = await scratch.cleanup();
    assert.deepEqual(report.dropped, [`runlayer_g2_test_br_clean_${SUFFIX}`]);
    assert.deepEqual(report.failed, [{ name: `runlayer_g2_test_br_shadow_${SUFFIX}`, code: "drop_failed" }]);
    assert.deepEqual(report.leftovers, [`runlayer_g2_test_br_shadow_${SUFFIX}`]);
    await assert.rejects(() => scratch.finish(), (error: unknown) => error instanceof ScratchDatabaseError && error.names.includes(`runlayer_g2_test_br_shadow_${SUFFIX}`) && !SECRETS.test(error.message));
    assert.equal(log.filter((sql) => sql.startsWith("DROP")).length, 4, "two cleanups attempted each name once; nothing else was dropped");

    const listing = fakeAdmin({ failList: true });
    const { manager: second } = manager(listing.admin);
    await second.create("clean");
    const secondReport = await second.cleanup();
    assert.deepEqual(secondReport.failed, [{ name: "(listing)", code: "listing_failed" }]);
    await assert.rejects(() => second.finish());
});

// --- connected-database identity -------------------------------------------------------------------------------------------------------------

const EXPECTED: ExpectedIdentity = { database: "runlayer_g2_test", port: 54329, host: "127.0.0.1", dataDirectory: "/tmp/scratch/g2/pgdata" };
const FACTS: ConnectedFacts = { db: "runlayer_g2_test", port: 54329, addr: "127.0.0.1", dataDirectory: "/tmp/scratch/g2/pgdata" };

test("the connected-database identity must match on database, port, loopback address AND data directory", async () => {
    assert.deepEqual(evaluateConnectedIdentity(EXPECTED, FACTS), { ok: true });
    assert.deepEqual(evaluateConnectedIdentity(EXPECTED, { ...FACTS, port: BigInt(54329) }), { ok: true });
    assert.deepEqual(evaluateConnectedIdentity({ ...EXPECTED, host: "[::1]" }, { ...FACTS, addr: "::1" }), { ok: true });
    const cases: Array<[string, Partial<ConnectedFacts>, string]> = [
        ["another database", { db: "postgres" }, "identity_database_mismatch"],
        ["the real server's port", { port: 5432 }, "identity_port_mismatch"],
        ["a string port", { port: "54329" }, "identity_port_mismatch"],
        ["a non-loopback address", { addr: "192.0.2.7" }, "identity_address_mismatch"],
        ["no address (a unix socket)", { addr: null }, "identity_address_mismatch"],
        ["another data directory", { dataDirectory: "/Users/x/Library/Application Support/Postgres/var-17" }, "identity_data_directory_mismatch"],
        ["a data directory prefix", { dataDirectory: "/tmp/scratch/g2" }, "identity_data_directory_mismatch"],
        ["no data directory", { dataDirectory: undefined }, "identity_data_directory_mismatch"],
    ];
    for (const [label, patch, reason] of cases) {
        const verdict = evaluateConnectedIdentity(EXPECTED, { ...FACTS, ...patch });
        assert.ok(!verdict.ok && verdict.reasons.includes(reason), label);
        await assert.rejects(() => verifyConnectedIdentity(async () => ({ ...FACTS, ...patch }), EXPECTED), (error: unknown) => error instanceof ConnectedIdentityError && error.reasons.includes(reason), label);
    }
    assert.deepEqual(evaluateConnectedIdentity(EXPECTED, null as unknown as ConnectedFacts), { ok: false, reasons: ["identity_facts_invalid"] });
    await assert.rejects(() => verifyConnectedIdentity(async () => { throw new Error("connect ECONNREFUSED postgresql://u:pw-secret@127.0.0.1:54329/x"); }, EXPECTED), (error: unknown) => error instanceof ConnectedIdentityError && error.reasons.join() === "identity_query_failed" && !SECRETS.test(error.message));
});

test("a matching URL is not identity: the expected identity comes from the target URL, and the data directory must come from the validated environment", () => {
    assert.deepEqual(expectedIdentityFor("postgresql://u:pw-secret@127.0.0.1:54329/runlayer_g2_test", "/tmp/scratch/g2/pgdata"), EXPECTED);
    assert.equal(expectedDataDirectoryFromEnv({ RUNLAYER_TEST_EXPECTED_DATA_DIR: "/tmp/scratch/g2/pgdata" }), "/tmp/scratch/g2/pgdata");
    for (const value of [undefined, "", "relative/pgdata", "/tmp/a/../pgdata", "/tmp/a//pgdata", "/tmp/pgdata/", "/", "/tmp/with space/pgdata"]) {
        assert.throws(() => expectedDataDirectoryFromEnv({ RUNLAYER_TEST_EXPECTED_DATA_DIR: value }), (error: unknown) => error instanceof ConnectedIdentityError, String(value));
    }
});
