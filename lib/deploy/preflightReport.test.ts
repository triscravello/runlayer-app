import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAX_EVIDENCE_AGE_MINUTES, MAX_ALLOWED_EVIDENCE_AGE_MINUTES, canonicalJson, digestOf, evaluateEvidence, reportSchema, summarizeFindings } from "./preflightReport";
import { CONTEXT, MIGRATIONS, NOW, TARGET, behindFacts, currentFacts, emptyFacts, reportFor, resealed } from "./testFixtures";
import { parseDatabaseTarget } from "./databaseTarget";
import { computeMigrationSet } from "./migrationFingerprint";

const check = { target: TARGET, migrationSet: MIGRATIONS, now: NOW };
const minutesAfter = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function reasonsFor(input: unknown, overrides: Partial<typeof check & { maxAgeMinutes: number }> = {}): string[] {
    const verdict = evaluateEvidence(JSON.parse(JSON.stringify(input)), { ...check, ...overrides });
    assert.equal(verdict.ok, false, "expected the evidence to be rejected");
    return verdict.ok ? [] : verdict.reasons;
}

test("canonical JSON ignores key order, and the digest follows the content", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } }), canonicalJson({ a: { c: null, d: [2, { y: 2, z: 1 }] }, b: 1 }));
    const report = reportFor(behindFacts());
    const { reportDigest, ...body } = report;
    assert.equal(reportDigest, digestOf(body));
    assert.notEqual(digestOf({ ...body, collectedAt: "2026-11-06T12:00:01.000Z" }), reportDigest);
});

test("a fresh, passing report for this target and migration set is accepted", () => {
    for (const facts of [emptyFacts(), behindFacts(), currentFacts()]) {
        const verdict = evaluateEvidence(JSON.parse(JSON.stringify(reportFor(facts))), check);
        assert.equal(verdict.ok, true, JSON.stringify(verdict));
    }
    const verdict = evaluateEvidence(JSON.parse(JSON.stringify(reportFor(behindFacts()))), check);
    assert.ok(verdict.ok);
    assert.equal(verdict.summary.schemaState, "behind");
    assert.equal(verdict.summary.pending.length, 3);
    assert.equal(verdict.summary.ageMinutes, 0);
});

test("the report conforms to its schema and carries the documented fields", () => {
    const report = reportFor(behindFacts());
    reportSchema.parse(report);
    assert.equal(report.reportVersion, 1);
    assert.equal(report.tool.name, "runlayer-preflight");
    assert.equal(report.collectedAt, NOW.toISOString());
    assert.equal(report.target.key, TARGET.key);
    assert.equal(report.migrationSet.fingerprint, MIGRATIONS.fingerprint);
    assert.equal(report.verification.status, "pass");
});

test("missing, unknown or wrongly typed fields are rejected", () => {
    const report = reportFor(currentFacts());
    const broken: unknown[] = [
        null,
        "report",
        {},
        { ...report, reportVersion: 2 },
        { ...report, extra: true },
        { ...report, tool: { ...report.tool, name: "other-tool" } },
        { ...report, collectedAt: undefined },
        { ...report, target: { ...report.target, extra: 1 } },
        { ...report, reportDigest: "short" },
        { ...report, findings: [{ code: "Bad Code", severity: "blocking", message: "x" }] },
        { ...report, audits: { ...report.audits, brands: { ...report.audits.brands, status: "skipped" } } },
    ];
    for (const value of broken) {
        assert.match(reasonsFor(value)[0], /not a valid preflight report/, JSON.stringify(value)?.slice(0, 60));
    }
});

test("an edited report is rejected even if the edit looks harmless", () => {
    const report = reportFor(currentFacts());
    const edited = { ...report, collectedAt: new Date(NOW.getTime() - 1000).toISOString() };
    assert.ok(reasonsFor(edited).some((reason) => /digest does not match/.test(reason)));

    const flipped = { ...report, verification: { status: "pass" as const, blockingFindings: 0 }, rowCounts: { users: 999 } };
    assert.ok(reasonsFor(flipped).some((reason) => /digest does not match/.test(reason)));
});

test("evidence for a different target is rejected", () => {
    const report = reportFor(currentFacts());
    for (const url of ["postgresql://u:p@other.test:5432/appdb", "postgresql://u:p@db.example.test:5433/appdb", "postgresql://u:p@db.example.test:5432/otherdb"]) {
        assert.ok(reasonsFor(report, { target: parseDatabaseTarget(url) }).some((reason) => /different target/.test(reason)), url);
    }
});

test("evidence for a different migration set is rejected", () => {
    const report = reportFor(currentFacts());
    const edited = computeMigrationSet([...MIGRATIONS.migrations.slice(0, -1).map((m) => ({ name: m.name, sql: m.name })), { name: "20261105200000_add_brand_normalized_name", sql: "-- edited" }], "lock");
    assert.ok(reasonsFor(report, { migrationSet: edited }).some((reason) => /different migration set/.test(reason)));

    const extra = computeMigrationSet([{ name: "20270101000000_new", sql: "SELECT 1;" }], "lock");
    assert.ok(reasonsFor(report, { migrationSet: extra }).some((reason) => /different (migration set|number)/.test(reason)));
});

test("stale evidence is rejected, and the age limit is bounded", () => {
    const report = reportFor(currentFacts());
    assert.equal(evaluateEvidence(JSON.parse(JSON.stringify(report)), { ...check, now: minutesAfter(DEFAULT_MAX_EVIDENCE_AGE_MINUTES) }).ok, true);
    assert.ok(reasonsFor(report, { now: minutesAfter(DEFAULT_MAX_EVIDENCE_AGE_MINUTES + 1) }).some((reason) => /older than 30 minutes/.test(reason)));

    assert.equal(evaluateEvidence(JSON.parse(JSON.stringify(report)), { ...check, now: minutesAfter(90), maxAgeMinutes: 120 }).ok, true);
    // A huge requested limit is clamped to the ceiling, never honored.
    assert.ok(reasonsFor(report, { now: minutesAfter(MAX_ALLOWED_EVIDENCE_AGE_MINUTES + 5), maxAgeMinutes: 100_000 }).some((reason) => /older than 240 minutes/.test(reason)));
});

test("evidence dated in the future is rejected, small clock skew is tolerated", () => {
    const report = reportFor(currentFacts());
    assert.equal(evaluateEvidence(JSON.parse(JSON.stringify(report)), { ...check, now: minutesAfter(-1) }).ok, true);
    assert.ok(reasonsFor(report, { now: minutesAfter(-10) }).some((reason) => /future/.test(reason)));
});

test("a failing preflight is rejected, whatever else it says", () => {
    const failing = reportFor(currentFacts({ outfitDuplicates: { groups: 2, removableRows: 3 } }));
    assert.equal(failing.verification.status, "fail");
    const reasons = reasonsFor(failing);
    assert.ok(reasons.some((reason) => /did not pass/.test(reason)));
    assert.ok(reasons.some((reason) => /blocking findings/.test(reason)));

    // Claiming a pass while carrying a blocking finding is caught by the consistency check.
    const lying = resealed(failing, (body) => {
        body.verification = { status: "pass", blockingFindings: 0 };
    });
    assert.ok(reasonsFor(lying).some((reason) => /blocking findings|inconsistent/.test(reason)));
});

test("schema states that need a person are rejected", () => {
    const untracked = reportFor(currentFacts({ history: null }));
    assert.equal(untracked.schema.state, "untracked");
    assert.ok(reasonsFor(untracked).some((reason) => /schema state "untracked"/.test(reason)));

    const failed = reportFor(currentFacts({ history: [...currentFacts().history!.slice(0, 9), { name: MIGRATIONS.migrations[9].name, checksum: MIGRATIONS.migrations[9].checksum, finished: false, rolledBack: false }] }));
    assert.equal(failed.schema.state, "failed_migration");
    assert.ok(reasonsFor(failed).some((reason) => /failed migration/.test(reason)));

    // A report that lies about its state is still stopped by the explicit state check.
    const forced = resealed(reportFor(currentFacts()), (body) => {
        body.schema.state = "drift";
    });
    assert.ok(reasonsFor(forced).some((reason) => /schema state "drift"/.test(reason)));
});

test("identity, read-only collection, recovery and replica evidence are all required", () => {
    const base = reportFor(currentFacts());
    const cases: Array<[RegExp, (body: Omit<typeof base, "reportDigest">) => void]> = [
        [/verified target identity/, (body) => { body.target.identityVerified = false; }],
        [/read-only collection/, (body) => { body.target.readOnlyTransaction = false; }],
        [/different database name/, (body) => { body.target.database = "other"; }],
        [/in recovery/, (body) => { body.target.inRecovery = true; }],
    ];
    for (const [pattern, mutate] of cases) assert.ok(reasonsFor(resealed(base, mutate)).some((reason) => pattern.test(reason)), String(pattern));
});

test("an audit cannot be skipped for a table that exists", () => {
    const skipped = resealed(reportFor(currentFacts()), (body) => {
        body.audits.brands.status = "not_applicable";
    });
    assert.ok(reasonsFor(skipped).some((reason) => /audit that should have run was skipped/.test(reason)));

    const pendingElsewhere = resealed(reportFor(currentFacts()), (body) => {
        body.schema.pending = ["20300101000000_not_in_this_repository"];
    });
    assert.ok(reasonsFor(pendingElsewhere).some((reason) => /does not exist in this repository/.test(reason)));
});

test("rejection reasons are fixed text and list every problem at once", () => {
    const report = reportFor(currentFacts());
    const reasons = reasonsFor(resealed(report, (body) => { body.target.key = "other.test:5432/appdb"; }), { now: minutesAfter(500) });
    assert.ok(reasons.length >= 2);
    for (const reason of reasons) assert.doesNotMatch(reason, /s3cr3t|postgres(ql)?:\/\//i);
    assert.equal(new Set(reasons).size, reasons.length);
});

test("summaries list blocking and warning findings in a fixed vocabulary", () => {
    const lines = summarizeFindings(reportFor(behindFacts({ identity: { ...behindFacts().identity, serverVersion: "15.8", isSuperuser: true } })));
    assert.ok(lines.some((line) => line.startsWith("[warning] role_is_superuser")));
    assert.ok(lines.some((line) => line.startsWith("[warning] server_major_not_verified")));
    assert.equal(CONTEXT.target.key, TARGET.key);
});
