import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { CHILD_ENV_PASSTHROUGH, EXECUTE_SCRIPT_NAME, GUARD_ENV, buildPrismaInvocation, evaluateGuard, parseGuardArgs, type GuardDecision, type GuardEnv } from "./migrationGuard";
import { MIGRATIONS, NOW, OTHER_URL, SENTINEL_PASSWORD, TARGET, TARGET_URL, behindFacts, currentFacts, reportFor, resealed } from "./testFixtures";

const EVIDENCE_PATH = "preflight-test.json";
const goodEvidence = () => JSON.stringify(reportFor(behindFacts()));

function goodEnv(overrides: Record<string, string | undefined> = {}): GuardEnv {
    return {
        [GUARD_ENV.target]: TARGET_URL,
        [GUARD_ENV.allowlist]: TARGET.key,
        [GUARD_ENV.confirm]: TARGET.key,
        ...overrides,
    };
}

type Run = { env?: GuardEnv; argv?: string[]; evidence?: string | (() => string); now?: Date };

function run({ env = goodEnv(), argv = ["--evidence", EVIDENCE_PATH], evidence = goodEvidence(), now = NOW }: Run = {}): { decision: GuardDecision; reads: string[] } {
    const reads: string[] = [];
    const decision = evaluateGuard({
        env,
        argv,
        now,
        migrationSet: MIGRATIONS,
        readEvidence: (file) => {
            reads.push(file);
            return typeof evidence === "function" ? evidence() : evidence;
        },
    });
    return { decision, reads };
}

function refusal(options: Run) {
    const { decision } = run(options);
    assert.equal(decision.ok, false, "expected a refusal");
    if (decision.ok) throw new Error("unreachable");
    // Nothing a refusal says may contain the connection string, the password or the evidence path's contents.
    const text = JSON.stringify(decision.reasons);
    assert.doesNotMatch(text, new RegExp(SENTINEL_PASSWORD));
    assert.doesNotMatch(text, /postgres(ql)?:\/\/\S*@/i);
    return decision;
}

test("with every input correct the guard passes in check mode and executes nothing", () => {
    const { decision, reads } = run();
    assert.ok(decision.ok);
    assert.equal(decision.execute, false);
    assert.equal(decision.target.key, TARGET.key);
    assert.equal(decision.summary.schemaState, "behind");
    assert.deepEqual(reads, [EVIDENCE_PATH]);
});

test("--execute is carried through only when everything else passes", () => {
    const { decision } = run({ argv: ["--evidence", EVIDENCE_PATH, "--execute"], env: goodEnv({ npm_lifecycle_event: EXECUTE_SCRIPT_NAME }) });
    assert.ok(decision.ok && decision.execute === true);
    assert.ok(run({ argv: ["--execute", "--evidence=x.json"] }).decision.ok, "a direct invocation (no npm lifecycle) is allowed");
});

// ---- Arguments ---------------------------------------------------------------------------------------------------------

test("only --evidence and --execute are accepted; nothing is forwarded to Prisma", () => {
    for (const argv of [["--evidence", "a.json", "--force"], ["--evidence", "a.json", "--schema", "x"], ["--evidence", "a.json", "--accept-data-loss"], ["migrate", "reset"], ["--evidence", "a.json", "extra"], ["--url", "postgresql://x"]]) {
        assert.equal(refusal({ argv }).stage, "arguments", argv.join(" "));
    }
    for (const argv of [["--evidence"], ["--evidence", "--execute"], ["--evidence="], ["--evidence", "a", "--evidence", "b"], ["--execute", "--execute", "--evidence", "a"]]) {
        assert.equal(refusal({ argv }).stage, "arguments", argv.join(" "));
    }
    assert.deepEqual(parseGuardArgs(["--evidence=a.json"]), { ok: true, args: { evidencePath: "a.json", execute: false } });
});

test("the evidence file is required", () => {
    const decision = refusal({ argv: [] });
    assert.equal(decision.stage, "arguments");
    assert.match(decision.reasons[0], /--evidence/);
});

test("an invalid evidence age setting is refused", () => {
    for (const value of ["0", "-5", "abc", "1.5", "241", "99999", "1e2"]) assert.equal(refusal({ env: goodEnv({ [GUARD_ENV.maxAgeMinutes]: value }) }).stage, "arguments", value);
});

// ---- Target ------------------------------------------------------------------------------------------------------------

test("a missing target is refused, and DATABASE_URL is never used as a fallback", () => {
    for (const env of [
        { [GUARD_ENV.allowlist]: TARGET.key, [GUARD_ENV.confirm]: TARGET.key },
        // The only database URL available is DATABASE_URL, even though it would pass every other check.
        { DATABASE_URL: TARGET_URL, [GUARD_ENV.allowlist]: TARGET.key, [GUARD_ENV.confirm]: TARGET.key },
        { DATABASE_URL: TARGET_URL, DIRECT_URL: TARGET_URL, [GUARD_ENV.allowlist]: TARGET.key, [GUARD_ENV.confirm]: TARGET.key, [GUARD_ENV.target]: "" },
    ]) {
        const decision = refusal({ env });
        assert.equal(decision.stage, "target");
        assert.match(decision.reasons[0], /DATABASE_URL is deliberately ignored/);
    }
});

test("DATABASE_URL pointing elsewhere does not change the target", () => {
    const { decision } = run({ env: goodEnv({ DATABASE_URL: OTHER_URL }) });
    assert.ok(decision.ok);
    assert.equal(decision.target.key, TARGET.key);
});

test("malformed, ambiguous and unsafe targets are refused", () => {
    for (const value of ["not a url", "mysql://u:p@db.example.test/appdb", "postgresql://u:p@db.example.test:5432,other.test:5432/appdb", "postgresql://u:p@db.example.test/appdb?host=evil.test", "postgresql://u:p@db.example.test:6543/appdb", "postgresql://u:p@*.example.test/appdb"]) {
        assert.equal(refusal({ env: goodEnv({ [GUARD_ENV.target]: value }) }).stage, "target", value);
    }
});

// ---- Allowlist and confirmation ------------------------------------------------------------------------------------------

test("a missing or malformed allowlist is refused", () => {
    for (const value of [undefined, "", "*", "*.example.test:5432/appdb", "db.example.test", "db.example.test:5432/*"]) {
        assert.equal(refusal({ env: goodEnv({ [GUARD_ENV.allowlist]: value }) }).stage, "allowlist", String(value));
    }
});

test("the wrong host, port or database is refused", () => {
    for (const entry of ["other.test:5432/appdb", "db.example.test:5433/appdb", "db.example.test:5432/other", "example.test:5432/appdb", "db.example.test:5432/appdb2"]) {
        assert.equal(refusal({ env: goodEnv({ [GUARD_ENV.allowlist]: entry }) }).stage, "allowlist", entry);
    }
    // An approved entry for another database does not approve this one, even listed next to it.
    assert.ok(run({ env: goodEnv({ [GUARD_ENV.allowlist]: `other.test:5432/x, ${TARGET.key}` }) }).decision.ok);
});

test("an incorrect or missing operator confirmation is refused", () => {
    for (const value of [undefined, "", "appdb", "yes", "db.example.test/appdb", `${TARGET.key} `, "other.test:5432/appdb", TARGET_URL]) {
        assert.equal(refusal({ env: goodEnv({ [GUARD_ENV.confirm]: value }) }).stage, "confirmation", String(value));
    }
});

// ---- Evidence ----------------------------------------------------------------------------------------------------------

test("unreadable, non-JSON and invalid evidence is refused", () => {
    assert.equal(refusal({ evidence: () => { throw new Error(`ENOENT with ${SENTINEL_PASSWORD}`); } }).stage, "evidence");
    assert.match(refusal({ evidence: () => { throw new Error("ENOENT"); } }).reasons[0], /could not be read/);
    assert.match(refusal({ evidence: "{ not json" }).reasons[0], /not valid JSON/);
    assert.match(refusal({ evidence: "{}" }).reasons[0], /not a valid preflight report/);
    assert.match(refusal({ evidence: "null" }).reasons[0], /not a valid preflight report/);
});

test("stale evidence is refused, and the age limit can be tightened or modestly loosened", () => {
    const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    assert.ok(run({ now: later(30) }).decision.ok);
    assert.ok(refusal({ now: later(31) }).reasons.some((reason) => /older than 30 minutes/.test(reason)));
    assert.ok(refusal({ now: later(10), env: goodEnv({ [GUARD_ENV.maxAgeMinutes]: "5" }) }).reasons.some((reason) => /older than 5 minutes/.test(reason)));
    assert.ok(run({ now: later(100), env: goodEnv({ [GUARD_ENV.maxAgeMinutes]: "120" }) }).decision.ok);
});

test("evidence for another target or another migration set is refused", () => {
    const otherTarget = JSON.stringify(resealed(reportFor(behindFacts()), (body) => { body.target.key = "db.other.test:5432/appdb"; }));
    assert.ok(refusal({ evidence: otherTarget }).reasons.some((reason) => /different target/.test(reason)));

    const otherMigrations = JSON.stringify(resealed(reportFor(behindFacts()), (body) => { body.migrationSet.fingerprint = "a".repeat(64); }));
    assert.ok(refusal({ evidence: otherMigrations }).reasons.some((reason) => /different migration set/.test(reason)));
});

test("failed, incomplete or tampered evidence is refused", () => {
    const failed = JSON.stringify(reportFor(currentFacts({ outfitDuplicates: { groups: 1, removableRows: 1 } })));
    assert.ok(refusal({ evidence: failed }).reasons.some((reason) => /did not pass/.test(reason)));

    const incomplete = JSON.stringify(resealed(reportFor(behindFacts()), (body) => { body.audits.outfitItems.status = "not_applicable"; }));
    assert.ok(refusal({ evidence: incomplete }).reasons.some((reason) => /audit that should have run was skipped/.test(reason)));

    const tampered = JSON.stringify({ ...reportFor(behindFacts()), rowCounts: { users: 1 } });
    assert.ok(refusal({ evidence: tampered }).reasons.some((reason) => /digest/.test(reason)));
});

test("a schema state a person must resolve is refused even when the report passes otherwise", () => {
    const untracked = JSON.stringify(reportFor(currentFacts({ history: null })));
    assert.ok(refusal({ evidence: untracked }).reasons.some((reason) => /untracked/.test(reason)));
});

test("a report is never accepted as authorization on its own", () => {
    // A perfect report with no allowlist, no confirmation or no target still does nothing.
    for (const env of [{}, { [GUARD_ENV.target]: TARGET_URL }, { [GUARD_ENV.target]: TARGET_URL, [GUARD_ENV.allowlist]: TARGET.key }]) {
        assert.equal(run({ env }).decision.ok, false);
    }
});

// ---- Lifecycle ---------------------------------------------------------------------------------------------------------

test("--execute is refused from any other npm lifecycle", () => {
    for (const lifecycle of ["dev", "build", "start", "test", "postinstall", "db:deploy", "db:seed", "npx", "prepare"]) {
        const decision = refusal({ argv: ["--evidence", EVIDENCE_PATH, "--execute"], env: goodEnv({ npm_lifecycle_event: lifecycle }) });
        assert.equal(decision.stage, "lifecycle", lifecycle);
    }
    // Check mode has no such restriction.
    assert.ok(run({ env: goodEnv({ npm_lifecycle_event: "db:deploy" }) }).decision.ok);
});

// ---- Prisma invocation ---------------------------------------------------------------------------------------------------

const CWD = "/repo";

test("Prisma is started with fixed arguments and nothing the operator typed", () => {
    const invocation = buildPrismaInvocation({ target: TARGET, cwd: CWD, nodeExecutable: "/usr/bin/node", parentEnv: { PATH: "/usr/bin" } });
    assert.equal(invocation.command, "/usr/bin/node");
    assert.deepEqual(invocation.args, [path.join(CWD, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy", "--schema", path.join(CWD, "prisma", "schema.prisma")]);
    assert.equal(invocation.cwd, CWD);
    for (const forbidden of ["--accept-data-loss", "--force", "reset", "dev", "push", "resolve", "npx"]) assert.ok(!invocation.args.includes(forbidden));
});

test("Prisma receives exactly the approved target, whatever the parent environment holds", () => {
    const parentEnv: GuardEnv = {
        PATH: "/usr/bin",
        HOME: "/home/op",
        DATABASE_URL: OTHER_URL,
        DIRECT_URL: OTHER_URL,
        SHADOW_DATABASE_URL: OTHER_URL,
        PRISMA_QUERY_ENGINE_LIBRARY: "/tmp/evil.so",
        PRISMA_SCHEMA_ENGINE_BINARY: "/tmp/evil",
        BETTER_AUTH_SECRET: "should-not-leak",
        WEATHER_API_KEY: "should-not-leak",
        UPSTASH_REDIS_REST_TOKEN: "should-not-leak",
        [GUARD_ENV.target]: TARGET_URL,
        DOTENV_CONFIG_PATH: "/tmp/.env",
    };
    const { env } = buildPrismaInvocation({ target: TARGET, cwd: CWD, nodeExecutable: "node", parentEnv });

    assert.equal(env.DATABASE_URL, TARGET.url);
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.HOME, "/home/op");
    for (const name of Object.keys(env)) assert.ok(name === "DATABASE_URL" || name === "CHECKPOINT_DISABLE" || name === "PRISMA_HIDE_UPDATE_MESSAGE" || (CHILD_ENV_PASSTHROUGH as readonly string[]).includes(name), `unexpected variable ${name}`);
    for (const name of ["DIRECT_URL", "SHADOW_DATABASE_URL", "PRISMA_QUERY_ENGINE_LIBRARY", "PRISMA_SCHEMA_ENGINE_BINARY", "BETTER_AUTH_SECRET", "WEATHER_API_KEY", "UPSTASH_REDIS_REST_TOKEN", "DOTENV_CONFIG_PATH", GUARD_ENV.target]) assert.ok(!(name in env), name);
});

test("the target used by Prisma is the one that was approved, not a re-read value", () => {
    const first = run().decision;
    assert.ok(first.ok);
    const { env } = buildPrismaInvocation({ target: first.target, cwd: CWD, nodeExecutable: "node", parentEnv: { DATABASE_URL: OTHER_URL } });
    assert.equal(env.DATABASE_URL, TARGET_URL);
});
