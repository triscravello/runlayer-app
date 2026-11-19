import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    DisposableError, buildDisposableInvocations, evaluatePrismaStatus, extractKnownTables, parseDisposableTarget, readEnvKeyNames, sameEffectiveConfiguration,
    classifyLsofResult, parseLsofCwd, parseLsofListeners, parsePostmasterPid, validateDataDirectory, validateDatabaseIdentity, validatePortOwner, validatePrismaVersion,
    type DisposableInvocation, type IdentityFacts, type PortObservation,
} from "./disposableTarget";

// Offline tests of every pure safety gate. No database, no network, no child process. Each gate has at least one negative test.

const GOOD = "postgresql://g1_admin:pw-should-never-appear@127.0.0.1:54341/runlayer_g1_test_14";
const codeOf = (fn: () => unknown) => {
    try { fn(); } catch (error) {
        assert.ok(error instanceof DisposableError, "a DisposableError, not an arbitrary exception");
        assert.equal(error.message, error.code, "the message is the code only");
        assert.doesNotMatch(error.message, /pw-should-never-appear|127\.0\.0\.1|runlayer_/, "no part of the input is echoed");
        return error.code;
    }
    return "ACCEPTED";
};
const reject = (url: string | undefined | null, code?: string) => { const got = codeOf(() => parseDisposableTarget(url)); assert.notEqual(got, "ACCEPTED", String(url)); if (code) assert.equal(got, code, String(url)); };

test("valid disposable targets are accepted: literal IPv4 and IPv6 loopback, explicit port, strict database name, optional schema=public", () => {
    for (const url of [GOOD, "postgresql://u@127.0.0.1:54342/runlayer_g1_test_17", "postgres://u:p@127.0.0.1:50000/runlayer_test", "postgresql://u:p@[::1]:54341/runlayer_a_test", `${GOOD}?schema=public&connect_timeout=5`, "postgresql://u:p@127.0.0.1:1024/runlayer_x_test_y"]) {
        const target = parseDisposableTarget(url);
        assert.ok(target.port >= 1024 && !target.key.includes("pw-should-never-appear"));
    }
    assert.equal(parseDisposableTarget(GOOD).key, "127.0.0.1:54341/runlayer_g1_test_14");
});

test("missing, malformed or unsupported URLs are rejected", () => {
    reject(undefined, "target_missing"); reject(null, "target_missing"); reject("", "target_missing"); reject("   ", "target_missing");
    reject("not a url"); reject("mysql://u:p@127.0.0.1:54341/runlayer_test", "target_unsupported"); reject("postgresql://127.0.0.1:54341"); reject("postgresql://u:p@127.0.0.1:54341/runlayer_test/extra");
    reject(`${GOOD}#frag`);
});

test("hosts other than a literal loopback IP are rejected: localhost, hostnames, obfuscated forms, other private and public addresses", () => {
    for (const host of ["localhost", "LOCALHOST", "db.example.invalid", "127.1", "2130706433", "0x7f.0.0.1", "127.0.0.01", "0.0.0.0", "10.0.0.5", "192.168.1.5", "192.0.2.1", "[::ffff:127.0.0.1]", "[::2]", "128.0.0.1", "127.0.0.256"]) {
        reject(`postgresql://u:p@${host}:54341/runlayer_test`);
    }
    reject("postgresql://u:p@localhost:54341/runlayer_test", "host_not_loopback_literal");
    reject("postgresql://u:p@127.1:54341/runlayer_test", "host_not_loopback_literal");
});

test("a missing or ambiguous port, and the protected and privileged ports, are rejected", () => {
    reject("postgresql://u:p@127.0.0.1/runlayer_test", "port_missing");
    reject("postgresql://u:p@[::1]/runlayer_test", "port_missing");
    reject("postgresql://u:p@127.0.0.1:/runlayer_test");
    reject("postgresql://u:p@127.0.0.1:5432/runlayer_test", "protected_port");
    reject("postgresql://u:p@[::1]:5432/runlayer_test", "protected_port");
    reject("postgresql://u:p@127.0.0.1:6543/runlayer_test");
    for (const port of [1, 80, 1023]) reject(`postgresql://u:p@127.0.0.1:${port}/runlayer_test`, "port_out_of_range");
    for (const port of [0, 65536, 99999, "54a41"]) reject(`postgresql://u:p@127.0.0.1:${port}/runlayer_test`);
});

test("host and address overrides, multiple @ delimiters, wildcards and encoded hosts are rejected", () => {
    reject(`${GOOD}?host=db.example.invalid`); reject(`${GOOD}?hostaddr=192.0.2.1`); reject(`${GOOD}?service=prod`); reject(`${GOOD}?dbname=other`); reject(`${GOOD}?port=5432`);
    reject("postgresql://u@db.example.invalid@127.0.0.1:54341/runlayer_test", "target_ambiguous");
    reject("postgresql://u:p@127.0.0.1,db.example.invalid:54341/runlayer_test"); reject("postgresql://u:p@127.0.0.%31:54341/runlayer_test"); reject("postgresql://u:p@*:54341/runlayer_test");
});

test("unexpected query parameters are rejected; only schema=public and connect_timeout are allowed", () => {
    for (const query of ["sslmode=require", "application_name=x", "pgbouncer=true", "connection_limit=1", "schema=other", "schema=public&schema=public", "connect_timeout=abc", "connect_timeout=1000", "options=-c%20search_path%3Dx"]) reject(`${GOOD}?${query}`);
    assert.equal(codeOf(() => parseDisposableTarget(`${GOOD}?sslmode=require`)), "query_option_not_allowed");
});

test("a database name must satisfy the strict disposable convention; a test-like name is not enough on its own", () => {
    for (const name of ["app_test", "runlayer_prod", "runlayer", "runlayer_attest", "runlayer_testdb", "Runlayer_test", "RUNLAYER_TEST", "postgres", "runlayer_dev", "runlayer__test", "runlayer_test_", "test_runlayer"]) reject(`postgresql://u:p@127.0.0.1:54341/${name}`, "database_name_not_disposable");
    for (const name of ["runlayer_test", "runlayer_g1_test", "runlayer_g1_test_14", "runlayer_a_b_test_c_d"]) assert.ok(parseDisposableTarget(`postgresql://u:p@127.0.0.1:54341/${name}`));
});

const ROOT = "/tmp/scratch/g1";
test("the expected data directory must be present, absolute, canonical, inside the named root and not a development location", () => {
    assert.equal(validateDataDirectory(`${ROOT}/pg14`, ROOT), `${ROOT}/pg14`);
    assert.equal(validateDataDirectory(`${ROOT}/a/b/pg17`, ROOT), `${ROOT}/a/b/pg17`);
    for (const [dir, code] of [[undefined, "data_dir_missing"], [null, "data_dir_missing"], ["", "data_dir_missing"], [42, "data_dir_missing"], ["pg14", "data_dir_not_absolute"], ["./pg14", "data_dir_not_absolute"], ["../pg14", "data_dir_not_absolute"],
        [`${ROOT}/../g1/pg14`, "data_dir_ambiguous"], [`${ROOT}//pg14`, "data_dir_ambiguous"], [`${ROOT}/./pg14`, "data_dir_ambiguous"], [`${ROOT}/pg14/`, "data_dir_ambiguous"], [`${ROOT}/pg 14`, "data_dir_ambiguous"], [`${ROOT}/pg14\n`, "data_dir_ambiguous"], [`${ROOT}/pg14\u0000`, "data_dir_ambiguous"],
        [ROOT, "data_dir_outside_root"], ["/tmp/scratch/g10/pg14", "data_dir_outside_root"], ["/tmp/other/pg14", "data_dir_outside_root"], ["/", "data_dir_outside_root"],
        [`${ROOT}/Library/Application Support/Postgres/var-17`, "data_dir_ambiguous"], [`${ROOT}/usr/local/var/postgres`, "data_dir_protected"], [`${ROOT}/opt/homebrew/var/postgres@14`, "data_dir_protected"]] as const) {
        assert.equal(codeOf(() => validateDataDirectory(dir, ROOT)), code, String(dir));
    }
    assert.equal(codeOf(() => validateDataDirectory("/Users/x/Library/Application Support/Postgres/var-17", "/Users/x")), "data_dir_ambiguous", "whitespace is refused before the location is even judged");
    assert.equal(codeOf(() => validateDataDirectory("/usr/local/var/postgres", "/usr/local")), "data_dir_protected");
    for (const root of [undefined, "", "relative", "/", "/tmp/scratch/", "/tmp/../scratch"]) assert.equal(codeOf(() => validateDataDirectory(`${ROOT}/pg14`, root)), "root_invalid", String(root));
});

test("only the audited Prisma 5.22.x passes the version gate", () => {
    for (const version of ["5.22.0", "5.22.1", "5.22.12"]) assert.equal(validatePrismaVersion(version), true, version);
    for (const version of ["5.21.1", "5.23.0", "5.220.0", "6.0.0", "7.1.0", "4.16.2", "5.22", "5.22.0-dev.1", "5.22.0+x", "v5.22.0", " 5.22.0", "", null, undefined, 5.22, {}]) assert.equal(validatePrismaVersion(version), false, String(version));
});

const SCHEMA = readFileSync(fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)), "utf8");
const KNOWN = extractKnownTables(SCHEMA);
const target = parseDisposableTarget(GOOD);
const DIR = `${ROOT}/pg14`;
const goodFacts = (): IdentityFacts => ({ currentDatabase: "runlayer_g1_test_14", serverPort: 54341, serverAddress: "127.0.0.1", dataDirectory: DIR, databases: ["postgres", "runlayer_g1_test_14"], publicTables: [] });
const verdictOf = (facts: IdentityFacts) => validateDatabaseIdentity(target, DIR, facts, KNOWN);

test("the schema's table names are extracted from prisma/schema.prisma (mapped names, plus _prisma_migrations)", () => {
    for (const table of ["_prisma_migrations", "users", "gear_items", "gear_item_variants", "brands"]) assert.ok(KNOWN.has(table), table);
    assert.equal(KNOWN.has("User"), false, "the mapped table name is used, not the model name");
    assert.deepEqual([...extractKnownTables("model Plain {\n id String\n}\nmodel Mapped {\n id String\n @@map(\"m_t\")\n}")].sort(), ["Plain", "_prisma_migrations", "m_t"]);
});

test("a fresh disposable server and a repeat run over known tables are accepted; mask suffixes and IPv6 loopback are normalized", () => {
    assert.deepEqual(verdictOf(goodFacts()), { ok: true });
    assert.deepEqual(verdictOf({ ...goodFacts(), serverAddress: "127.0.0.1/32", publicTables: [...KNOWN] }), { ok: true });
    assert.deepEqual(validateDatabaseIdentity(parseDisposableTarget("postgresql://u@[::1]:54341/runlayer_g1_test_14"), DIR, { ...goodFacts(), serverAddress: "::1/128" }, KNOWN), { ok: true });
});

test("every unexpected database identity is rejected, each with its own reason", () => {
    const cases: Array<[string, Partial<IdentityFacts>]> = [
        ["database_name_mismatch", { currentDatabase: "postgres" }], ["database_name_mismatch", { currentDatabase: undefined }],
        ["server_port_mismatch", { serverPort: 5432 }], ["server_port_mismatch", { serverPort: "54341" }], ["server_port_mismatch", { serverPort: null }],
        ["server_address_not_loopback", { serverAddress: "10.0.0.5" }], ["server_address_not_loopback", { serverAddress: null }], ["server_address_not_loopback", { serverAddress: "127.0.0.1/24" }],
        ["data_directory_mismatch", { dataDirectory: "/usr/local/var/postgres" }], ["data_directory_mismatch", { dataDirectory: `${DIR}/` }], ["data_directory_mismatch", { dataDirectory: undefined }],
        ["unexpected_databases_present", { databases: ["postgres", "runlayer_g1_test_14", "customers"] }], ["target_database_not_listed", { databases: ["postgres"] }], ["database_list_invalid", { databases: "postgres" }], ["database_list_invalid", { databases: undefined }],
        ["unexpected_schema_contents", { publicTables: ["users", "customers"] }], ["unexpected_schema_contents", { publicTables: ["Users"] }], ["table_list_invalid", { publicTables: undefined }], ["table_list_invalid", { publicTables: [1] }],
    ];
    for (const [reason, patch] of cases) {
        const verdict = verdictOf({ ...goodFacts(), ...patch });
        assert.equal(verdict.ok, false, JSON.stringify(patch));
        assert.ok(!verdict.ok && verdict.reasons.includes(reason), `${JSON.stringify(patch)} -> ${JSON.stringify(!verdict.ok && verdict.reasons)}`);
    }
    const everythingWrong = verdictOf({ currentDatabase: 1, serverPort: 1, serverAddress: 1, dataDirectory: 1, databases: 1, publicTables: 1 });
    assert.ok(!everythingWrong.ok && everythingWrong.reasons.length >= 6);
});

test("lsof output parsers accept exactly the expected shapes and reject everything else", () => {
    assert.deepEqual(parseLsofListeners("p4242\ncpostgres\nf5\nn127.0.0.1:54341\nf6\nn[::1]:54341\n"), [{ pid: 4242, command: "postgres", addresses: ["127.0.0.1:54341", "[::1]:54341"] }]);
    assert.equal(parseLsofListeners("p1\ncpostgres\nn*:5432\n")?.[0]?.addresses[0], "*:5432");
    for (const bad of ["", "\n", "cpostgres\nn127.0.0.1:1\n", "p0\ncx\nn127.0.0.1:1\n", "pabc\ncx\nn127.0.0.1:1\n", "p1\nn127.0.0.1:1\n", "p1\ncx\n", "p1\ncx\ncy\nn127.0.0.1:1\n", "p1\ncx\nn127.0.0.1\n", "p1\ncx\nnlocalhost:1\n", "p1\ncx\nzz\nn127.0.0.1:1\n", "p1\ncx\nn127.0.0.1:1 (LISTEN)\n"]) {
        assert.equal(parseLsofListeners(bad), null, JSON.stringify(bad));
    }
    assert.equal(parseLsofCwd(`p7\nfcwd\nn${DIR}\n`, 7), DIR);
    for (const [bad, pid] of [[`p8\nfcwd\nn${DIR}\n`, 7], [`p7\nftxt\nn${DIR}\n`, 7], ["p7\nfcwd\nnrel\n", 7], [`p7\nfcwd\nn${DIR}\np9\nfcwd\nn/x\n`, 7], ["", 7]] as const) assert.equal(parseLsofCwd(bad, pid), null, bad);
    assert.deepEqual(parsePostmasterPid(`4242\n${DIR}\n1763560000\n54341\n\n127.0.0.1\n x\nready\n`), { pid: 4242, dataDirectory: DIR, port: 54341 });
    for (const bad of ["", "4242\n", "x\n/d\n1\n54341\n", `4242\nrelative\n1\n54341\n`, `4242\n${DIR}\n1\nnotaport\n`, `0\n${DIR}\n1\n54341\n`]) assert.equal(parsePostmasterPid(bad), null, JSON.stringify(bad));
});

test("lsof results are classified fail-closed: found, found nothing, or unavailable", () => {
    assert.deepEqual(classifyLsofResult({ status: 0, stdout: "p1\n", stderr: "" }), { kind: "ok", stdout: "p1\n" });
    assert.deepEqual(classifyLsofResult({ status: 1, stdout: "", stderr: "" }), { kind: "none" });
    for (const raw of [{ errorCode: "ENOENT", status: null }, { errorCode: "EPERM", status: null }, { errorCode: "ETIMEDOUT", status: null }, { status: null }, { status: 0 }, { status: 1, stdout: "", stderr: "lsof: permission denied" }, { status: 1, stdout: "p1\n" }, { status: 2 }, { status: 127 }] as Array<{ errorCode?: string; status: number | null; stdout?: string; stderr?: string }>) {
        assert.deepEqual(classifyLsofResult({ stdout: "", stderr: "", ...raw }), { kind: "unavailable" }, JSON.stringify(raw));
    }
});

test("validatePortOwner: exactly one postgres listener, loopback-only, with the expected cwd, a matching postmaster.pid and an unchanged re-observation", () => {
    const L = (pid = 4242, command = "postgres", addresses = ["127.0.0.1:54341"]) => ({ pid, command, addresses });
    const T = { host: "127.0.0.1", port: 54341 };
    const observe = (over: Partial<PortObservation> = {}): PortObservation => ({ listeners: [L()], cwd: DIR, postmasterPid: { pid: 4242, dataDirectory: DIR, port: 54341 }, relisted: [L()], ...over });
    assert.deepEqual(validatePortOwner(T, DIR, observe()), { ok: true });
    assert.deepEqual(validatePortOwner(T, DIR, observe({ listeners: [L(4242, "postgres", ["127.0.0.1:54341", "[::1]:54341"])], relisted: [L(4242, "postgres", ["[::1]:54341", "127.0.0.1:54341"])] })), { ok: true }, "address order is irrelevant");
    assert.deepEqual(validatePortOwner({ host: "[::1]", port: 54341 }, DIR, observe({ listeners: [L(4242, "postgres", ["[::1]:54341"])], relisted: [L(4242, "postgres", ["[::1]:54341"])] })), { ok: true });
    const reasonsOf = (o: PortObservation | null) => { const v = validatePortOwner(T, DIR, o); assert.equal(v.ok, false); return v.ok ? [] : v.reasons; };
    assert.deepEqual(reasonsOf(null), ["port_not_listening"]);
    assert.deepEqual(reasonsOf(observe({ listeners: [] })), ["port_not_listening"]);
    assert.deepEqual(reasonsOf(observe({ listeners: [L(1), L(2)] })), ["port_owner_ambiguous"]);
    assert.deepEqual(reasonsOf(observe({ listeners: [L(4242), L(4242)] })), ["port_owner_ambiguous"], "two entries are never silently merged");
    assert.deepEqual(reasonsOf(observe({ cwd: null })), ["port_owner_mismatch"]);
    assert.deepEqual(reasonsOf(observe({ cwd: `${DIR}/` })), ["port_owner_mismatch"]);
    assert.deepEqual(reasonsOf(observe({ postmasterPid: null })), ["postgres_identity_mismatch"]);
    assert.deepEqual(reasonsOf(observe({ postmasterPid: { pid: 4243, dataDirectory: DIR, port: 54341 } })), ["postgres_identity_mismatch"]);
    assert.deepEqual(reasonsOf(observe({ relisted: [L(4243)] })), ["port_owner_changed"]);
    assert.deepEqual(reasonsOf(observe({ relisted: [] })), ["port_owner_changed"]);
    assert.ok(reasonsOf(observe({ listeners: [L(4242, "node", ["0.0.0.0:54341"])], cwd: "/x", postmasterPid: null })).length >= 4, "every failing check is reported");
});

test("dotenv key names are read without their values", () => {
    assert.deepEqual(readEnvKeyNames("# c\nDATABASE_URL=\"postgresql://x:secret@h/db\"\n  export SUPABASE_URL=https://x\nUPSTASH_TOKEN = t\nbad line\n1X=2\nDATABASE_URL=again\n"), ["DATABASE_URL", "SUPABASE_URL", "UPSTASH_TOKEN"]);
});

const HOSTILE_PARENT = { PATH: "/usr/bin", HOME: "/home/x", DATABASE_URL: "postgresql://attacker:x@db.example.invalid:5432/prod", DIRECT_URL: "postgresql://a:b@d.example.invalid/x", SUPABASE_URL: "https://p.example.invalid", UPSTASH_REDIS_REST_TOKEN: "tok", REDIS_URL: "rediss://r.example.invalid", PGHOST: "pg.example.invalid", PGSERVICE: "prod", NODE_OPTIONS: "--require /evil.js", RUNLAYER_DISPOSABLE_URL: GOOD, WEATHER_API_KEY: "k" };
const build = (dotenv: string[] = ["DATABASE_URL", "SUPABASE_URL", "UPSTASH_REDIS_REST_TOKEN", "REDIS_URL", "WEATHER_API_KEY"]) => buildDisposableInvocations({ target, cwd: "/repo", nodeExecutable: "/usr/bin/node", parentEnv: HOSTILE_PARENT, dotenvKeyNames: dotenv });

test("the Prisma environment is an allowlist: the target is the only DATABASE_URL, hostile parent and .env values cannot reach it", () => {
    const { status } = build();
    assert.equal(status.env.DATABASE_URL, target.url, "an ambient or .env DATABASE_URL cannot override the target");
    for (const name of ["DIRECT_URL", "PGHOST", "PGSERVICE", "NODE_OPTIONS", "RUNLAYER_DISPOSABLE_URL"]) assert.equal(name in status.env, false, `${name} is not inherited`);
    for (const name of ["SUPABASE_URL", "UPSTASH_REDIS_REST_TOKEN", "REDIS_URL", "WEATHER_API_KEY"]) assert.equal(status.env[name], "", `${name} is pre-defined empty so Prisma cannot copy it from .env`);
    assert.equal(status.env.PATH, "/usr/bin");
    assert.equal(status.env.CHECKPOINT_DISABLE, "1"); assert.equal(status.env.PRISMA_HIDE_UPDATE_MESSAGE, "1"); assert.equal(status.env.NO_UPDATE_NOTIFIER, "1");
    assert.equal(JSON.stringify(status.env).includes("example.invalid"), false);
    assert.equal(Object.keys(build([]).status.env).includes("SUPABASE_URL"), false, "only names actually found in .env are blanked");
    assert.deepEqual(Object.keys(build(["bad name", "1X", "OK_NAME"]).status.env).filter((name) => /bad|1X|OK_NAME/.test(name)), ["OK_NAME"], "malformed names are ignored");
});

test("verification and migration share one frozen environment and differ only in the Prisma subcommand; Prisma runs through node, not npx", () => {
    const { status, deploy } = build();
    assert.equal(status.env, deploy.env, "the very same object");
    assert.ok(Object.isFrozen(status.env) && Object.isFrozen(status.args));
    assert.deepEqual(status.args.slice(1), ["migrate", "status", "--schema", "/repo/prisma/schema.prisma"]);
    assert.deepEqual(deploy.args.slice(1), ["migrate", "deploy", "--schema", "/repo/prisma/schema.prisma"]);
    assert.equal(status.args[0], "/repo/node_modules/prisma/build/index.js");
    assert.equal(status.command, "/usr/bin/node");
    assert.equal(/npx|reset|dev|push|execute/.test([...status.args, ...deploy.args].join(" ")), false, "no other Prisma command is ever constructed");
    assert.equal(sameEffectiveConfiguration(status, deploy), true);
});

test("configurations that are not identical are detected", () => {
    const { status, deploy } = build();
    const mutate = (patch: Partial<DisposableInvocation>): DisposableInvocation => ({ ...deploy, ...patch });
    assert.equal(sameEffectiveConfiguration(status, mutate({ env: { ...deploy.env } })), false, "an equal-looking copy is not the same object");
    assert.equal(sameEffectiveConfiguration(status, mutate({ env: { ...deploy.env, DATABASE_URL: "postgresql://u@127.0.0.1:54342/runlayer_test" } })), false);
    assert.equal(sameEffectiveConfiguration(status, mutate({ cwd: "/elsewhere" })), false);
    assert.equal(sameEffectiveConfiguration(status, mutate({ command: "/usr/bin/npx" })), false);
    assert.equal(sameEffectiveConfiguration(status, mutate({ args: [...deploy.args, "--force"] })), false);
    assert.equal(sameEffectiveConfiguration(status, mutate({ args: [deploy.args[0] as string, "db", "deploy", "--schema", "/repo/prisma/schema.prisma"] })), false);
    assert.equal(sameEffectiveConfiguration(status, mutate({ args: [deploy.args[0] as string, "migrate", "deploy", "--schema", "/other/schema.prisma"] })), false);
});

const DATASOURCE = (db = "runlayer_g1_test_14", address = "127.0.0.1:54341", schema = "public") => `Prisma schema loaded from prisma/schema.prisma\nDatasource "db": PostgreSQL database "${db}", schema "${schema}" at "${address}"\n`;
const UP_TO_DATE = `${DATASOURCE()}\n11 migrations found in prisma/migrations\n\nDatabase schema is up to date!\n`;
const PENDING = `${DATASOURCE()}\n11 migrations found in prisma/migrations\n\nFollowing migrations have not yet been applied:\n20260528183058_add_user_roles\n20260629195746_add_gear_item_variants_p1234\n\nTo apply migrations in development run prisma migrate dev.\n`;

test("Prisma's own statement of its target must match, and only recognized outcomes pass", () => {
    assert.deepEqual(evaluatePrismaStatus(UP_TO_DATE, 0, target), { ok: true, state: "up_to_date" });
    assert.deepEqual(evaluatePrismaStatus(PENDING, 1, target), { ok: true, state: "pending" }, "a migration NAME containing p1234 is not an error code");
    assert.deepEqual(evaluatePrismaStatus(UP_TO_DATE.replace("127.0.0.1:54341", "[::1]:54341"), 0, parseDisposableTarget("postgresql://u@[::1]:54341/runlayer_g1_test_14")), { ok: true, state: "up_to_date" });
});

test("a missing, duplicated or different target line, an error, or unrecognized output stops everything", () => {
    const bad = (output: string, exit: number | null, reason: string) => { const verdict = evaluatePrismaStatus(output, exit, target); assert.ok(!verdict.ok && verdict.reasons.includes(reason), `${reason}: ${JSON.stringify(verdict)}`); };
    bad("", 0, "prisma_target_line_missing"); bad("Database schema is up to date!\n", 0, "prisma_target_line_missing"); bad(UP_TO_DATE.replace("Datasource", "Datasrc"), 0, "prisma_target_line_missing"); bad("Error: Environment variable not found: DATABASE_URL.\n", 1, "prisma_target_line_missing");
    bad(`${DATASOURCE()}${DATASOURCE()}Database schema is up to date!`, 0, "prisma_target_line_ambiguous");
    bad(`${DATASOURCE("runlayer_other_test")}Database schema is up to date!`, 0, "prisma_target_database_mismatch");
    bad(`${DATASOURCE(undefined, "127.0.0.1:54342")}Database schema is up to date!`, 0, "prisma_target_address_mismatch");
    bad(`${DATASOURCE(undefined, "127.0.0.1:5432")}Database schema is up to date!`, 0, "prisma_target_address_mismatch");
    bad(`${DATASOURCE(undefined, "db.example.invalid:54341")}Database schema is up to date!`, 0, "prisma_target_address_mismatch");
    bad(`${DATASOURCE(undefined, "127.0.0.1")}Database schema is up to date!`, 0, "prisma_target_address_mismatch");
    bad(`${DATASOURCE(undefined, undefined, "other")}Database schema is up to date!`, 0, "prisma_target_schema_mismatch");
    bad(`${DATASOURCE()}\nError: P1001: Can't reach database server at \`127.0.0.1:54341\`\n`, 1, "prisma_output_reports_a_problem");
    bad(`${UP_TO_DATE}\nP3009 migrate found failed migrations\n`, 1, "prisma_output_reports_a_problem");
    bad(`${PENDING}\nThe migration was modified after it was applied (drift detected)\n`, 1, "prisma_output_reports_a_problem");
    bad(`${DATASOURCE()}Something new Prisma prints\n`, 0, "prisma_output_unrecognized"); bad(UP_TO_DATE, 1, "prisma_output_unrecognized"); bad(UP_TO_DATE, null, "prisma_output_unrecognized"); bad(PENDING, 0, "prisma_output_unrecognized"); bad(PENDING, 2, "prisma_output_unrecognized");
});

test("the launcher's integration validator rejects the protected port and a missing port, and still accepts a legitimate disposable loopback target", () => {
    const { checkIntegrationTarget } = createRequire(import.meta.url)("../../test-support/isolation/target.cjs") as { checkIntegrationTarget: (env: Record<string, string>) => { ok: boolean; reason?: string } };
    const env = (url: string) => ({ RUNLAYER_ALLOW_DB_TESTS: "1", RUNLAYER_TEST_DATABASE_URL: url });
    assert.equal(checkIntegrationTarget(env("postgresql://u:p@127.0.0.1:54341/runlayer_g1_test_14")).ok, true);
    assert.equal(checkIntegrationTarget(env("postgresql://u:p@[::1]:54341/runlayer_g1_test_14")).ok, true);
    for (const url of ["postgresql://u:p@127.0.0.1:5432/runlayer_g1_test_14", "postgresql://u:p@localhost:5432/runlayer_g1_test_14", "postgresql://u:p@127.0.0.1/runlayer_g1_test_14", "postgresql://u:p@[::1]:5432/runlayer_g1_test_14"]) {
        const verdict = checkIntegrationTarget(env(url));
        assert.equal(verdict.ok, false, url);
        assert.doesNotMatch(verdict.reason ?? "", /u:p|runlayer_g1/, "the reason names no value");
    }
});
