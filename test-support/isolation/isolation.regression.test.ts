// Regression tests for the test-isolation safeguard (guard.cjs, runTests.mjs, the lib/prisma.ts gate). Every case runs in a child
// process with an explicit, minimal environment. Hostile values use reserved `.invalid` names, so even a broken guard could not
// reach a real host. Assertions are on booleans and categories; nothing here prints or compares a real URL or credential.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkTestDatabase } from "../../lib/auth/testDatabaseGuard";

const root = fileURLToPath(new URL("../../", import.meta.url));
const guard = join(root, "test-support", "isolation", "guard.cjs");
const launcher = join(root, "scripts", "runTests.mjs");
const fixture = (name: string) => join(root, "test-support", "isolation", "fixtures", name);

const BASE = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
const HOSTILE = {
    ...BASE,
    DATABASE_URL: "postgresql://attacker:x@db.example.invalid:5432/prod",
    DIRECT_URL: "postgresql://attacker:x@direct.example.invalid:5432/prod",
    SHADOW_DATABASE_URL: "postgresql://attacker:x@shadow.example.invalid:5432/prod",
    REDIS_URL: "rediss://cache.example.invalid:6379",
    UPSTASH_REDIS_REST_URL: "https://redis.example.invalid",
    UPSTASH_REDIS_REST_TOKEN: "token-sentinel",
    SUPABASE_URL: "https://project.example.invalid",
    SUPABASE_ANON_KEY: "key-sentinel",
    WEATHER_API_KEY: "key-sentinel",
    PGHOST: "pg.example.invalid",
    CUSTOM_HOSTED_SERVICE_URL: "postgresql://x:y@other.example.invalid/db",
    RUNLAYER_ALLOW_DB_TESTS: "1",
    RUNLAYER_TEST_DATABASE_URL: "postgresql://x:y@127.0.0.1:54329/runlayer_regression_test",
};
const VALID_INTEGRATION = {
    ...BASE,
    RUNLAYER_ALLOW_DB_TESTS: "1",
    RUNLAYER_TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:54329/runlayer_regression_test",
    // What `npm run db:disposable:check` validated: the same database, and the data directory the suites will confirm.
    RUNLAYER_DISPOSABLE_URL: "postgresql://u@127.0.0.1:54329/runlayer_regression_test",
    RUNLAYER_DISPOSABLE_DATA_DIR: "/tmp/scratch/pgdata",
};

const run = (args: string[], env: Record<string, string>, cwd = root) => spawnSync(process.execPath, args, { cwd, env: env as NodeJS.ProcessEnv, encoding: "utf8", timeout: 120_000 });
const report = (result: ReturnType<typeof run>) => {
    const line = (result.stdout ?? "").split("\n").find((entry) => entry.startsWith("REPORT "));
    assert.ok(line, `no REPORT line (exit ${result.status}); stderr starts: ${(result.stderr ?? "").slice(0, 200)}`);
    return JSON.parse(line.slice("REPORT ".length)) as Record<string, unknown>;
};

test("the isolation preload is active in this very test process (the suite runs under npm test)", () => {
    assert.ok((globalThis as { __RUNLAYER_TEST_ISOLATION__?: { active: boolean } }).__RUNLAYER_TEST_ISOLATION__?.active, "run the suite with `npm test`");
});

test("1+4+5: a real Prisma client built during module import cannot use a hosted DATABASE_URL; late hosted URLs, sockets and fetch are refused", () => {
    const rep = report(run(["--require", guard, "--import", "tsx", fixture("import-time-prisma.fixture.mts")], HOSTILE));
    assert.equal(rep.guardActive, true);
    assert.equal(rep.profile, "unit");
    assert.equal(rep.realClientBuiltDuringImport, true);
    assert.equal(rep.databaseHost, "127.0.0.1");
    assert.deepEqual(rep.protectedLeft, []);
    assert.equal(rep.socketBlocked, true);
    assert.equal(rep.fetchBlocked, true);
    assert.equal(rep.lateHostedUrlBlocked, true);
    assert.equal(rep.explicitHostedUrlBlocked, true);
});

test("2: Prisma cannot repopulate protected credentials from the repository's .env files", { skip: !existsSync(join(root, ".env")) && !existsSync(join(root, "prisma", ".env")) && "no .env file in this checkout; the key-name handling is covered by the next test" }, () => {
    const rep = report(run(["--require", guard, "--import", "tsx", fixture("import-time-prisma.fixture.mts")], BASE));
    assert.ok((rep.envFileKeys as number) > 0);
    assert.deepEqual(rep.envFileKeysNotBlank, []);
});

test("2: every key NAME in an .env file is pre-defined as empty, so Prisma's copy of .env cannot define it (names only are read)", () => {
    const dir = mkdtempSync(join(tmpdir(), "runlayer-iso-"));
    try {
        writeFileSync(join(dir, ".env"), "# COMMENTED_OUT=1\nCUSTOM_HOSTED_SERVICE_URL=postgresql://x:y@h.example.invalid/db\nexport SOME_API_TOKEN=secret-sentinel\n  SPACED = 1\n");
        const result = run(["--require", guard, "-e", "console.log('REPORT '+JSON.stringify({c:process.env.CUSTOM_HOSTED_SERVICE_URL,t:process.env.SOME_API_TOKEN,s:process.env.SPACED,x:process.env.COMMENTED_OUT}))"], { ...BASE, RUNLAYER_TEST_ROOT: dir });
        assert.deepEqual(report(result), { c: "", t: "", s: "" });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("3: a direct `tsx --test` run without the preload fails closed when Prisma initializes", () => {
    const result = run(["--import", "tsx", "--test", fixture("direct-run.fixture.mts")], { ...BASE, DATABASE_URL: HOSTILE.DATABASE_URL });
    assert.equal(result.status, 0, `fixture test failed: ${(result.stdout ?? "").slice(-400)}`);
    assert.match(result.stdout ?? "", /^# pass 1$/m);
});

test("5: dns, sockets and fetch to non-loopback destinations are blocked; loopback and unix sockets are not", () => {
    const script = `
        const net=require("node:net"),dns=require("node:dns");
        const blocked=(f)=>{try{f();return false}catch(e){return e.name==="TestIsolationError"}};
        const out={
          socket:blocked(()=>net.connect({host:"db.example.invalid",port:5432})),
          socketIp:blocked(()=>net.connect({host:"192.0.2.1",port:5432})),
          dns:blocked(()=>dns.lookup("api.example.invalid",()=>{})),
        };
        (async()=>{
          try{await fetch("https://api.example.invalid/");out.fetch=false}catch(e){out.fetch=e.name==="TestIsolationError"}
          try{await dns.promises.lookup("api.example.invalid");out.dnsPromises=false}catch(e){out.dnsPromises=e.name==="TestIsolationError"}
          const s=net.connect({host:"127.0.0.1",port:1});s.on("error",(e)=>{out.loopbackAllowed=e.code==="ECONNREFUSED";console.log("REPORT "+JSON.stringify(out))});
        })();`;
    assert.deepEqual(report(run(["--require", guard, "-e", script], BASE)), { socket: true, socketIp: true, dns: true, fetch: true, dnsPromises: true, loopbackAllowed: true });
});

const INTEGRATION_CASES: Array<[string, Record<string, string>]> = [
    ["no opt-in flag", { ...VALID_INTEGRATION, RUNLAYER_ALLOW_DB_TESTS: "" }],
    ["no target", { ...VALID_INTEGRATION, RUNLAYER_TEST_DATABASE_URL: "" }],
    ["remote host", { ...VALID_INTEGRATION, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:p@db.example.invalid:54329/app_test" }],
    ["host-override parameter", { ...VALID_INTEGRATION, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:54329/app_test?host=db.example.invalid" }],
    ["database name without 'test'", { ...VALID_INTEGRATION, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:54329/app" }],
    ["not a PostgreSQL URL", { ...VALID_INTEGRATION, RUNLAYER_TEST_DATABASE_URL: "mysql://u:p@127.0.0.1:3306/app_test" }],
    ["same target as DATABASE_URL", { ...VALID_INTEGRATION, DATABASE_URL: "postgresql://u:p@127.0.0.1:54329/runlayer_regression_test" }],
    ["default port 5432 (the real local server)", { ...VALID_INTEGRATION, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/runlayer_regression_test" }],
    ["no port (means 5432)", { ...VALID_INTEGRATION, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1/runlayer_regression_test" }],
    ["localhost on 5432", { ...VALID_INTEGRATION, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/runlayer_regression_test" }],
    ["unparsable", { ...VALID_INTEGRATION, RUNLAYER_TEST_DATABASE_URL: "not a url" }],
];

test("7: missing or remote integration configuration is refused by the launcher and by the preload, before anything starts", () => {
    for (const [label, env] of INTEGRATION_CASES) {
        const viaLauncher = run([launcher, "--integration", "--dry-run"], env);
        assert.equal(viaLauncher.status, 2, `launcher accepted: ${label}`);
        assert.match(viaLauncher.stderr ?? "", /refused: .*No|refused: /);
        assert.equal(viaLauncher.stdout ?? "", "", label);
        assert.doesNotMatch(`${viaLauncher.stdout}${viaLauncher.stderr}`, /example\.invalid|attacker|:p@/, `launcher echoed a value: ${label}`);

        const viaPreload = run(["--require", guard, "-e", "console.log('STARTED')"], { ...env, RUNLAYER_TEST_PROFILE: "integration" });
        assert.notEqual(viaPreload.status, 0, `preload accepted: ${label}`);
        assert.doesNotMatch(viaPreload.stdout ?? "", /STARTED/, label);
        assert.doesNotMatch(`${viaPreload.stdout}${viaPreload.stderr}`, /example\.invalid|attacker|:p@/, `preload echoed a value: ${label}`);
    }
});

test("6: a valid local integration configuration is accepted, keeps its opt-in variables, and still blocks remote access", () => {
    const dry = run([launcher, "--integration", "--dry-run"], VALID_INTEGRATION);
    assert.equal(dry.status, 0, dry.stderr ?? "");
    const plan = JSON.parse(dry.stdout) as { profile: string; files: number };
    assert.equal(plan.profile, "integration");
    assert.ok(plan.files >= 5, "all *.integration.test.ts files are selected");

    const script = `const o={allow:process.env.RUNLAYER_ALLOW_DB_TESTS,hasTarget:!!process.env.RUNLAYER_TEST_DATABASE_URL,appHost:new URL(process.env.DATABASE_URL).hostname,profile:globalThis.__RUNLAYER_TEST_ISOLATION__.profile};
        try{require("node:net").connect({host:"db.example.invalid",port:5432});o.remoteBlocked=false}catch(e){o.remoteBlocked=e.name==="TestIsolationError"}console.log("REPORT "+JSON.stringify(o))`;
    assert.deepEqual(report(run(["--require", guard, "-e", script], { ...VALID_INTEGRATION, RUNLAYER_TEST_PROFILE: "integration" })), { allow: "1", hasTarget: true, appHost: "127.0.0.1", profile: "integration", remoteBlocked: true });
});

test("7: the launcher, the preload and lib/auth/testDatabaseGuard apply ONE rule set: they accept and refuse exactly the same targets", () => {
    for (const [label, env] of [["valid", VALID_INTEGRATION] as const, ...INTEGRATION_CASES]) {
        const existing = checkTestDatabase(env).ok;
        const fresh = run([launcher, "--integration", "--dry-run"], env).status === 0;
        assert.equal(fresh, existing, label);
        const preload = run(["--require", guard, "-e", "console.log('STARTED')"], { ...env, RUNLAYER_TEST_PROFILE: "integration" }).status === 0;
        assert.equal(preload, existing, `preload: ${label}`);
    }
});

test("8: ordinary `npm test` skips the opt-in integration suites on purpose, even when the opt-in variables are set", () => {
    const files = ["lib/auth/session.integration.test.ts", "lib/db/outfitRepository.integration.test.ts", "lib/ingestion/importGear.integration.test.ts", "prisma/brandConstraints.integration.test.ts", "prisma/outfitConstraints.integration.test.ts"];
    const result = run([launcher, ...files], HOSTILE);
    assert.equal(result.status, 0, (result.stdout ?? "").slice(-500));
    assert.match(result.stdout ?? "", /^# fail 0$/m);
    assert.match(result.stdout ?? "", new RegExp(`^# skipped ${files.length}$`, "m"));
    assert.match(result.stdout ?? "", /^# pass 0$/m);
});

// A throwaway project that holds only a copy of the launcher and the isolation support files, so the launcher's discovery and
// exit-status rules can be exercised with fake integration tests. No database is involved and nothing connects anywhere.
function withFakeProject(integrationTests: Record<string, string>, body: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "runlayer-launcher-"));
    try {
        mkdirSync(join(dir, "scripts"));
        mkdirSync(join(dir, "test-support", "isolation"), { recursive: true });
        copyFileSync(launcher, join(dir, "scripts", "runTests.mjs"));
        for (const name of ["guard.cjs", "target.cjs"]) copyFileSync(join(root, "test-support", "isolation", name), join(dir, "test-support", "isolation", name));
        symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
        for (const [name, source] of Object.entries(integrationTests)) writeFileSync(join(dir, name), source);
        body(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test("7: the integration launcher fails, before running anything, when zero integration tests are discovered", () => {
    withFakeProject({}, (dir) => {
        for (const extra of [[], ["--dry-run"]]) {
            const result = run([join(dir, "scripts", "runTests.mjs"), "--integration", ...extra], VALID_INTEGRATION, dir);
            assert.equal(result.status, 2);
            assert.match(result.stderr ?? "", /no integration test files were found/);
            assert.equal(result.stdout ?? "", "");
        }
    });
});

test("8: a skipped integration test makes the integration launcher exit nonzero; the same run with the test passing exits zero", () => {
    withFakeProject({ "a.integration.test.ts": 'import test from "node:test";\ntest("fake integration test", { skip: "skipped on purpose" }, () => {});\n' }, (dir) => {
        const result = run([join(dir, "scripts", "runTests.mjs"), "--integration"], VALID_INTEGRATION, dir);
        assert.equal(result.status, 3, (result.stdout ?? "").slice(-300));
        assert.match(result.stderr ?? "", /1 integration test\(s\) were skipped/);
    });
    withFakeProject({ "a.integration.test.ts": 'import test from "node:test";\ntest("fake integration test", () => {});\n' }, (dir) => {
        const result = run([join(dir, "scripts", "runTests.mjs"), "--integration"], VALID_INTEGRATION, dir);
        assert.equal(result.status, 0, (result.stdout ?? "").slice(-300));
        assert.match(result.stdout ?? "", /^# skipped 0$/m);
    });
});

// --- G2-A2-I: runner-to-wrapper identity, ambient preloads, sequential execution, direct execution ------------------------------------------------

const dryRun = (env: Record<string, string>) => run([launcher, "--integration", "--dry-run"], env);
const refusedBy = (env: Record<string, string>, code: RegExp) => {
    const result = dryRun(env);
    assert.equal(result.status, 2, `accepted: ${code}`);
    assert.match(result.stderr ?? "", code);
    assert.equal(result.stdout ?? "", "");
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /u:p@|127\.0\.0\.1:54329|runlayer_regression_test/, "no URL, credential or database name is printed");
};

test("9: the runner refuses, before launching anything, unless the wrapper's target and the suites' target are the same valid database", () => {
    const plan = JSON.parse(dryRun(VALID_INTEGRATION).stdout) as { concurrency: number; agreedTarget: string };
    assert.equal(plan.concurrency, 1, "integration suites run strictly one file at a time");
    assert.equal(plan.agreedTarget, "127.0.0.1:54329/runlayer_regression_test", "only host, port and database are reported, never credentials");

    refusedBy({ ...VALID_INTEGRATION, RUNLAYER_DISPOSABLE_URL: "" }, /wrapper_target_missing/);
    refusedBy({ ...VALID_INTEGRATION, RUNLAYER_DISPOSABLE_URL: "postgresql://u@localhost:54329/runlayer_regression_test" }, /wrapper_target_invalid/);
    refusedBy({ ...VALID_INTEGRATION, RUNLAYER_DISPOSABLE_URL: "postgresql://u@127.0.0.1:5432/runlayer_regression_test" }, /wrapper_target_invalid/);
    refusedBy({ ...VALID_INTEGRATION, RUNLAYER_DISPOSABLE_URL: "postgresql://u@127.0.0.1:54330/runlayer_regression_test" }, /wrapper_test_target_mismatch/);
    refusedBy({ ...VALID_INTEGRATION, RUNLAYER_DISPOSABLE_URL: "postgresql://u@127.0.0.2:54329/runlayer_regression_test" }, /wrapper_test_target_mismatch/);
    refusedBy({ ...VALID_INTEGRATION, RUNLAYER_DISPOSABLE_URL: "postgresql://u@127.0.0.1:54329/runlayer_other_test" }, /wrapper_test_target_mismatch/);
    refusedBy({ ...VALID_INTEGRATION, RUNLAYER_DISPOSABLE_DATA_DIR: "" }, /wrapper_data_dir_missing/);
    refusedBy({ ...VALID_INTEGRATION, RUNLAYER_DISPOSABLE_DATA_DIR: "pgdata" }, /wrapper_data_dir_not_absolute/);
    refusedBy({ ...VALID_INTEGRATION, RUNLAYER_DISPOSABLE_DATA_DIR: "/tmp/a/../pgdata" }, /wrapper_data_dir_ambiguous/);
    refusedBy({ ...VALID_INTEGRATION, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:6543/runlayer_regression_test", RUNLAYER_DISPOSABLE_URL: "postgresql://u@127.0.0.1:6543/runlayer_regression_test" }, /pooler/);
});

test("9: integration mode refuses an ambient preload in NODE_OPTIONS instead of preserving it, and still allows harmless options", () => {
    const dir = mkdtempSync(join(tmpdir(), "runlayer-preload-"));
    try {
        const harmless = join(dir, "noop.cjs");
        writeFileSync(harmless, "// does nothing\n");
        for (const options of [`--require ${harmless}`, `-r ${harmless}`, `--import ${harmless}`, `--loader ${harmless}`, `--max-old-space-size=2048 --require=${harmless}`]) {
            refusedBy({ ...VALID_INTEGRATION, NODE_OPTIONS: options }, /node_options_preload_present/);
        }
        assert.equal(dryRun({ ...VALID_INTEGRATION, NODE_OPTIONS: "--max-old-space-size=2048" }).status, 0, "a harmless option is allowed");
        assert.equal(run([launcher, "--dry-run"], { ...BASE, NODE_OPTIONS: `--require ${harmless}` }).status, 0, "ordinary unit-test behavior is unchanged");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("9: the test processes never see the wrapper's variables, get the validated data directory, and the integration files run one at a time", () => {
    const fake = (name: string) => `import test from "node:test";
import { appendFileSync } from "node:fs";
test("fake ${name}", async () => {
    const log = process.env.FAKE_LOG as string;
    appendFileSync(log, "start-${name}\\n");
    appendFileSync(log, "env-${name} " + JSON.stringify({ wrapperVariables: Object.keys(process.env).filter((key) => key.startsWith("RUNLAYER_DISPOSABLE_")), dataDirectory: process.env.RUNLAYER_TEST_EXPECTED_DATA_DIR, concurrencyArg: process.execArgv.concat(process.argv).filter((arg) => arg.startsWith("--test-concurrency")) }) + "\\n");
    await new Promise((resolve) => setTimeout(resolve, 700));
    appendFileSync(log, "end-${name}\\n");
});
`;
    const logDir = mkdtempSync(join(tmpdir(), "runlayer-fake-log-"));
    const log = join(logDir, "events.log");
    try {
        withFakeProject({ "a.integration.test.ts": fake("a"), "b.integration.test.ts": fake("b") }, (dir) => {
            const result = run([join(dir, "scripts", "runTests.mjs"), "--integration"], { ...VALID_INTEGRATION, FAKE_LOG: log }, dir);
            assert.equal(result.status, 0, `${(result.stdout ?? "").slice(-400)}${(result.stderr ?? "").slice(-300)}`);
        });
        const lines = readFileSync(log, "utf8").trim().split("\n");
        const events = lines.filter((line) => /^(start|end)-/.test(line));
        assert.deepEqual(events.map((line) => line.replace(/-[ab]$/, "")), ["start", "end", "start", "end"], `files must not interleave: ${events.join(", ")}`);
        assert.equal(events[0]?.slice(-1), events[1]?.slice(-1), "each file finishes before the next one starts");
        for (const line of lines.filter((entry) => entry.startsWith("env-"))) {
            const report = JSON.parse(line.slice(line.indexOf("{"))) as { wrapperVariables: string[]; dataDirectory: string };
            assert.deepEqual(report.wrapperVariables, [], "RUNLAYER_DISPOSABLE_* is stripped from the test processes");
            assert.equal(report.dataDirectory, "/tmp/scratch/pgdata", "the wrapper's validated data directory is passed on under the test-side name");
        }
    } finally {
        rmSync(logDir, { recursive: true, force: true });
    }
});

const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
const directRun = (file: string, env: Record<string, string>) => spawnSync(process.execPath, [tsxCli, "--test", file], { cwd: root, env: env as NodeJS.ProcessEnv, encoding: "utf8", timeout: 120_000 });

test("10: running an integration file DIRECTLY (no launcher, no preload) refuses an invalid target loudly before any connection; not opted in, it skips", () => {
    // Every target below is unreachable or invalid by construction, so even a broken guard could not touch a real server.
    const suite = "prisma/brandConstraints.integration.test.ts";
    for (const url of ["postgresql://u:p@localhost:54997/runlayer_x_test", "postgresql://u:p@127.0.0.1:54997/app_test", "postgresql://u:p@127.0.0.1/runlayer_x_test", "postgresql://u:p@127.1:54997/runlayer_x_test", "postgresql://u:p@db.example.invalid:54997/runlayer_x_test", "postgresql://u:p@127.0.0.1:6543/runlayer_x_test"]) {
        const result = directRun(suite, { ...BASE, RUNLAYER_ALLOW_DB_TESTS: "1", RUNLAYER_TEST_DATABASE_URL: url });
        assert.notEqual(result.status, 0, `a direct run must fail: ${url.replace(/:p@/, ":<>@")}`);
        assert.match(`${result.stdout}${result.stderr}`, /integration tests refused/, url.replace(/:p@/, ":<>@"));
        assert.doesNotMatch(`${result.stdout}${result.stderr}`, /:p@|example\.invalid/, "no URL echoed");
    }
    const skipped = directRun(suite, { ...BASE, RUNLAYER_TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/anything" });
    assert.equal(skipped.status, 0, `${skipped.stdout}${skipped.stderr}`.slice(-400));
    assert.match(skipped.stdout, /^# skipped 1$/m, "without the opt-in the suite skips safely, before any connection");
});
