import assert from "node:assert/strict";
import test from "node:test";
import { auditBrands, auditExitCode, countPreferenceMentions, formatBrandAuditReport, type AuditBrand, type AuditGearItem } from "./brandKeyAudit";

const normalizeKey = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const brand = (id: string, name: string, storedKey?: string | null): AuditBrand => ({ id, name, ...(storedKey === undefined ? {} : { storedKey }) });
const gear = (brandId: string, name: string): AuditGearItem => ({ brandId, name });

test("a clean catalog has no findings", () => {
    const report = auditBrands([brand("1", "Nike"), brand("2", "Brooks"), brand("3", "Expntl Athletics")]);

    assert.equal(report.findings, 0);
    assert.equal(report.total, 3);
    assert.deepEqual(report.collisionGroups, []);
    assert.deepEqual(report.unsupportedForSqlBackfill, []);
});

test("exact collision groups: case, padding, whitespace runs and Unicode compatibility variants share a key", () => {
    const report = auditBrands([
        brand("a", "Nike"),
        brand("b", "nike"),
        brand("c", "  NIKE "),
        brand("d", "ＮＩＫＥ"),
        brand("e", "Expntl Athletics"),
        brand("f", "Expntl   athletics"),
        brand("g", "Brooks"),
    ]);

    // Members are listed by name in plain code-unit order: "  NIKE " < "Nike" < "nike" < the full-width spelling, and
    // "Expntl   athletics" < "Expntl Athletics" (its second space, 0x20, sorts before "A").
    assert.deepEqual(report.collisionGroups.map((group) => [group.key, group.brands.map((member) => member.id)]), [
        ["expntl athletics", ["f", "e"]],
        ["nike", ["c", "a", "b", "d"]],
    ]);
    // Two collision groups, plus the full-width spelling, which the SQL backfill cannot key (not ASCII).
    assert.deepEqual(report.unsupportedForSqlBackfill.map((entry) => entry.id), ["d"]);
    assert.equal(report.findings, 3);
});

test("names that differ only where the key does not fold stay separate (sharp s, zero-width space)", () => {
    const report = auditBrands([brand("1", "Straße"), brand("2", "STRASSE"), brand("3", "Nike​X"), brand("4", "NikeX")]);

    assert.deepEqual(report.collisionGroups, []);
});

test("names the SQL backfill cannot key are listed with their reasons", () => {
    const report = auditBrands([brand("1", "Café"), brand("2", "a\tb"), brand("3", "   "), brand("4", "x".repeat(101)), brand("5", "Fine")]);

    // Listed by name in code-unit order: "   " < "Caf\u00E9" < "a\tb" < "xxx...".
    assert.deepEqual(report.unsupportedForSqlBackfill.map((entry) => [entry.id, entry.reasons]), [
        ["3", ["blank"]],
        ["1", ["not-ascii"]],
        ["2", ["control-character"]],
        ["4", ["key-too-long"]],
    ]);
    assert.ok(report.findings >= 4);
});

test("invalid brand names (the application would never accept them) are reported separately from merely non-ASCII ones", () => {
    const report = auditBrands([brand("1", "Café"), brand("2", "a\u0000b"), brand("3", "   "), brand("4", "ﷺ".repeat(6))]);

    assert.deepEqual(report.invalidBrandNames.map((entry) => entry.id).sort(), ["2", "3", "4"], "Café is valid; the other three cannot be brand names");
});

test("gear counts and gear-name conflicts that would block repointing", () => {
    const report = auditBrands(
        [brand("a", "Nike"), brand("b", "nike")],
        [gear("a", "Run Top"), gear("a", "Cap"), gear("b", "Run Top"), gear("b", "Socks"), gear("zzz", "Run Top")],
    );

    const [group] = report.collisionGroups;
    assert.deepEqual(group.brands, [
        { id: "a", name: "Nike", gearCount: 2 },
        { id: "b", name: "nike", gearCount: 2 },
    ]);
    assert.deepEqual(group.gearNameConflicts, ["Run Top"], "only the name present under both brands conflicts; an unrelated brand's gear does not");
});

test("stored keys are checked against the key the application computes", () => {
    const report = auditBrands([brand("1", "Nike", "nike"), brand("2", "Brooks", "brooks-old"), brand("3", "Janji", null), brand("4", "On")]);

    assert.deepEqual(report.storedKeyMismatches, [
        { id: "2", name: "Brooks", storedKey: "brooks-old", expectedKey: "brooks" },
        { id: "3", name: "Janji", storedKey: null, expectedKey: "janji" },
    ]);
    assert.equal(report.storedKeyMismatches.some((entry) => entry.id === "4"), false, "a brand with no stored key supplied is not compared");
});

test("the report does not depend on input order", () => {
    const brands = [brand("c", "NIKE"), brand("a", "Nike"), brand("b", "nike"), brand("d", "Brooks")];
    const items = [gear("a", "x"), gear("b", "x"), gear("c", "y")];

    assert.deepEqual(auditBrands(brands, items), auditBrands([...brands].reverse(), [...items].reverse()));
});

test("preference mentions are counted per group without any user identifier", () => {
    const report = auditBrands([brand("a", "Nike"), brand("b", "nike"), brand("c", "Brooks"), brand("d", "BROOKS")]);
    const lists = [["Nike"], ["nike", "Adidas"], ["  NIKE  "], ["Adidas"], [], ["Brooks"], ["brooks", "Nike"]];

    assert.deepEqual(countPreferenceMentions(report, lists), [
        { key: "brooks", profiles: 2 },
        { key: "nike", profiles: 4 },
    ]);
});

test("the printed report shows invisible characters as escapes and never contains a connection string or user data", () => {
    const report = auditBrands([brand("a", "Nike"), brand("b", "nike\u200B"), brand("c", "NIKE"), brand("d", "Caf\u00E9")], [gear("a", "Run Top"), gear("c", "Run Top")]);
    const text = formatBrandAuditReport(report, countPreferenceMentions(report, [["nike"], ["Adidas"]]));

    assert.match(text, /Brands audited: 4/);
    assert.match(text, /Findings: \d+/);
    assert.ok(text.includes('"nike\\u200b"'), "the zero-width space is printed as an escape");
    assert.ok(text.includes('"Caf\\u00e9"'), "non-ASCII letters are escaped too");
    assert.equal(/[\u200B\u00E9]/.test(text), false, "no raw invisible or non-ASCII character reaches the output");
    assert.match(text, /key "nike"/);
    assert.match(text, /gear names present under more than one of these brands \(block an automatic merge\): "Run Top"/);
    assert.match(text, /profiles listing it as preferred\/avoided: 1/);
    assert.doesNotMatch(text, /postgres(ql)?:\/\//i);
    assert.equal(formatBrandAuditReport(auditBrands([brand("1", "Nike")])).includes("(clean)"), true);
});

// ---------------------------------------------------------------------------------------------------------------------
// PRE- vs POST-MIGRATION. Before brands.normalized_name exists, a name the ASCII SQL backfill cannot key blocks the
// migration, so it is a finding. After it exists, such a name is informational: a valid brand whose stored key is right.
// Every stored key is still verified against the authoritative JavaScript key, and real integrity problems still block.
// ---------------------------------------------------------------------------------------------------------------------
const PRE = { keysStored: false } as const;
const POST = { keysStored: true } as const;
const ids = (entries: Array<{ id: string }>) => entries.map((entry) => entry.id);

test("PRE-migration: an unsupported (non-ASCII) name is a blocking finding and the exit code is nonzero", () => {
    const report = auditBrands([brand("1", "Nike"), brand("2", "Caf\u00E9")], [], PRE);

    assert.equal(report.mode, "pre-migration");
    assert.deepEqual(ids(report.unsupportedForSqlBackfill), ["2"]);
    assert.equal(report.findings, 1);
    assert.equal(auditExitCode(report), 2);
});

test("PRE-migration: clean ASCII data is clean (exit 0), duplicates block (exit 2)", () => {
    const clean = auditBrands([brand("1", "Nike"), brand("2", "Brooks")], [], PRE);
    assert.deepEqual([clean.mode, clean.findings, auditExitCode(clean)], ["pre-migration", 0, 0]);

    const duplicated = auditBrands([brand("1", "Nike"), brand("2", "nike")], [], PRE);
    assert.deepEqual([duplicated.findings, auditExitCode(duplicated)], [1, 2]);
});

test("PRE-migration: every kind of unsupported name blocks (control character, blank, over-long, non-ASCII)", () => {
    for (const name of ["Caf\u00E9", "a\tb", "   ", "x".repeat(101), "\uFF2E\uFF29\uFF2B\uFF25"]) {
        const report = auditBrands([brand("1", name)], [], PRE);
        assert.ok(report.findings >= 1, JSON.stringify(name));
        assert.equal(auditExitCode(report), 2, JSON.stringify(name));
    }
});

test("POST-migration: a valid non-ASCII brand with the correct stored key is informational only (exit 0)", () => {
    const report = auditBrands([brand("1", "Nike", "nike"), brand("2", "Caf\u00E9", "caf\u00E9"), brand("3", "Stra\u00DFe", "stra\u00DFe"), brand("4", "\uFF2E\uFF29\uFF2B\uFF25 Run", "nike run")], [], POST);

    assert.equal(report.mode, "post-migration");
    assert.deepEqual(ids(report.unsupportedForSqlBackfill), ["2", "3", "4"], "still listed (by name, in code-unit order: Caf\u00E9, Stra\u00DFe, the full-width name), so the operator can see them");
    assert.deepEqual(report.storedKeyMismatches, []);
    assert.equal(report.findings, 0, "...but not counted");
    assert.equal(auditExitCode(report), 0);
});

test("POST-migration: clean data is exit 0", () => {
    const report = auditBrands([brand("1", "Nike", "nike"), brand("2", "Expntl   Athletics", "expntl athletics")], [], POST);
    assert.deepEqual([report.findings, auditExitCode(report)], [0, 0]);
});

test("POST-migration: every stored key is verified against the authoritative JavaScript key; a mismatch blocks", () => {
    const wrongNonAscii = auditBrands([brand("1", "Caf\u00E9", "cafe")], [], POST);
    assert.deepEqual(wrongNonAscii.storedKeyMismatches, [{ id: "1", name: "Caf\u00E9", storedKey: "cafe", expectedKey: "caf\u00E9" }], "an ASCII-folded guess is not the application's key");
    assert.deepEqual([wrongNonAscii.findings, auditExitCode(wrongNonAscii)], [1, 2]);

    for (const wrong of ["NIKE", " nike", "nike ", "ni ke", "", "corrupted-key"]) {
        const report = auditBrands([brand("1", "Nike", wrong)], [], POST);
        assert.equal(report.storedKeyMismatches.length, 1, JSON.stringify(wrong));
        assert.equal(auditExitCode(report), 2, JSON.stringify(wrong));
    }
});

test("POST-migration: a brand with no stored key at all is a mismatch when the column is known to exist", () => {
    const report = auditBrands([brand("1", "Nike")], [], POST);

    assert.deepEqual(report.storedKeyMismatches, [{ id: "1", name: "Nike", storedKey: null, expectedKey: "nike" }]);
    assert.equal(auditExitCode(report), 2);
});

test("POST-migration: duplicate identities and invalid names still block", () => {
    // Legacy / inconsistent rows: equivalent names whose stored keys were written differently.
    const legacy = auditBrands([brand("1", "Nike", "nike"), brand("2", "NIKE", "nike-legacy")], [], POST);
    assert.deepEqual(legacy.collisionGroups.map((group) => group.key), ["nike"]);
    assert.ok(legacy.storedKeyMismatches.some((entry) => entry.id === "2"));
    assert.equal(auditExitCode(legacy), 2);

    // A name the application would never accept (control character / blank / over-long key), even with a plausible key.
    for (const name of ["tab\there", "   ", "x".repeat(101), "\uFDFA".repeat(6)]) {
        const report = auditBrands([brand("1", name, normalizeKey(name))], [], POST);
        assert.deepEqual(ids(report.invalidBrandNames), ["1"], JSON.stringify(name));
        assert.equal(auditExitCode(report), 2, JSON.stringify(name));
    }
});

test("POST-migration: informational names do not hide real problems in the same database", () => {
    const report = auditBrands([brand("1", "Caf\u00E9", "caf\u00E9"), brand("2", "Nike", "wrong")], [], POST);

    assert.equal(report.findings, 1, "only the mismatch counts");
    assert.deepEqual(ids(report.storedKeyMismatches), ["2"]);
    assert.equal(auditExitCode(report), 2);
});

test("the database state is inferred from the data when not given, and an explicit state wins", () => {
    assert.equal(auditBrands([brand("1", "Nike")]).mode, "pre-migration");
    assert.equal(auditBrands([brand("1", "Nike", "nike")]).mode, "post-migration");
    assert.equal(auditBrands([]).mode, "pre-migration");
    assert.equal(auditBrands([], [], POST).mode, "post-migration");
    assert.equal(auditBrands([brand("1", "Nike", "nike")], [], PRE).mode, "pre-migration");
});

test("the exit-code matrix across both states", () => {
    const cases: Array<[label: string, report: ReturnType<typeof auditBrands>, expected: 0 | 2]> = [
        ["pre, ASCII, clean", auditBrands([brand("1", "Nike")], [], PRE), 0],
        ["pre, ASCII, duplicate", auditBrands([brand("1", "Nike"), brand("2", "nike")], [], PRE), 2],
        ["pre, non-ASCII", auditBrands([brand("1", "Caf\u00E9")], [], PRE), 2],
        ["post, clean", auditBrands([brand("1", "Nike", "nike")], [], POST), 0],
        ["post, valid non-ASCII with the correct key", auditBrands([brand("1", "Caf\u00E9", "caf\u00E9")], [], POST), 0],
        ["post, mismatched key", auditBrands([brand("1", "Nike", "nope")], [], POST), 2],
        ["post, duplicate identity", auditBrands([brand("1", "Nike", "nike"), brand("2", "NIKE", "other")], [], POST), 2],
        ["post, invalid name", auditBrands([brand("1", "a\tb", "a b")], [], POST), 2],
    ];

    for (const [label, report, expected] of cases) assert.equal(auditExitCode(report), expected, label);
});

test("the printed report labels the database state and the informational section", () => {
    const pre = formatBrandAuditReport(auditBrands([brand("1", "Caf\u00E9")], [], PRE));
    const post = formatBrandAuditReport(auditBrands([brand("1", "Caf\u00E9", "caf\u00E9")], [], POST));

    assert.match(pre, /Database state: pre-migration/);
    assert.match(pre, /Names the SQL backfill cannot key exactly \(need the JavaScript backfill\): 1/);
    assert.match(pre, /Findings: 1/);

    assert.match(post, /Database state: post-migration/);
    assert.match(post, /informational after the migration; valid when the stored key is correct\): 1/);
    assert.match(post, /Findings: 0 \(clean\)/);
    assert.ok(post.includes('"Caf\\u00e9"'), "the informational name is still listed, escaped");
});
