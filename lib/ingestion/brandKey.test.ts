import assert from "node:assert/strict";
import test from "node:test";
import { BRAND_KEY_MAX_LENGTH, BRAND_MAX_LENGTH, normalizeBrandKey, toBrandIdentity } from "./brandResolution";
import { sqlBackfillKey, sqlBackfillProblems } from "./brandKeyAudit";

// ---------------------------------------------------------------------------------------------------------------------
// GOLDEN VECTORS. The stored brands.normalized_name is whatever this function returned when the row was written. If a
// future Node/ICU/Unicode upgrade (or an edit to normalizeBrandKey) changes any key below, a stored key stops matching
// the key the application computes, and lookups by key would miss the existing row. These vectors make that loud: a
// failure here means "re-key the table" is an explicit decision, not an accident. Expected keys are written as code
// points so that invisible characters cannot be mangled by an editor.
// ---------------------------------------------------------------------------------------------------------------------
const codePoints = (value: string) => [...value].map((character) => (character.codePointAt(0) as number).toString(16));

const GOLDEN: Array<[label: string, input: string, expected: string[]]> = [
    ["plain ASCII", "Nike", ["6e", "69", "6b", "65"]],
    ["padding and inner runs", "  Expntl   Athletics ", ["65", "78", "70", "6e", "74", "6c", "20", "61", "74", "68", "6c", "65", "74", "69", "63", "73"]],
    ["full-width letters fold (NFKC)", "ＮＩＫＥ", ["6e", "69", "6b", "65"]],
    ["compatibility ligature fi", "ﬁnish", ["66", "69", "6e", "69", "73", "68"]],
    ["no-break space collapses to a space", "Expntl Athletics", ["65", "78", "70", "6e", "74", "6c", "20", "61", "74", "68", "6c", "65", "74", "69", "63", "73"]],
    ["tab collapses to a space", "Expntl\tAthletics", ["65", "78", "70", "6e", "74", "6c", "20", "61", "74", "68", "6c", "65", "74", "69", "63", "73"]],
    ["ideographic space collapses to a space", "Expntl　Athletics", ["65", "78", "70", "6e", "74", "6c", "20", "61", "74", "68", "6c", "65", "74", "69", "63", "73"]],
    ["zero-width space is NOT whitespace and is kept", "Nike​X", ["6e", "69", "6b", "65", "200b", "78"]],
    ["a leading byte-order mark is trimmed", "﻿Nike", ["6e", "69", "6b", "65"]],
    ["dotted capital I lowercases to i + combining dot", "İstanbul", ["69", "307", "73", "74", "61", "6e", "62", "75", "6c"]],
    ["dotless i is left alone", "ıstanbul", ["131", "73", "74", "61", "6e", "62", "75", "6c"]],
    ["sharp s stays (lowercase, not case-fold)", "Straße", ["73", "74", "72", "61", "df", "65"]],
    ["Greek final sigma is contextual", "ΟΔΟΣ", ["3bf", "3b4", "3bf", "3c2"]],
    ["NFD input composes (e + combining acute)", "Café", ["63", "61", "66", "e9"]],
    ["NFC input is unchanged", "Café", ["63", "61", "66", "e9"]],
    ["Kelvin sign folds to k", "K", ["6b"]],
    ["Roman numeral VIII expands", "Ⅷ", ["76", "69", "69", "69"]],
];

test("golden vectors: normalizeBrandKey returns exactly the recorded keys", () => {
    for (const [label, input, expected] of GOLDEN) {
        assert.deepEqual(codePoints(normalizeBrandKey(input)), expected, label);
    }
});

test("golden equivalences and non-equivalences that the stored key relies on", () => {
    const same = (a: string, b: string) => assert.equal(normalizeBrandKey(a), normalizeBrandKey(b), `${JSON.stringify(a)} should equal ${JSON.stringify(b)}`);
    const different = (a: string, b: string) => assert.notEqual(normalizeBrandKey(a), normalizeBrandKey(b), `${JSON.stringify(a)} should differ from ${JSON.stringify(b)}`);

    same("Café", "Café");
    same("ΟΔΟΣ", "οδος");
    same("K", "k");
    same("ＮＩＫＥ", "nike");
    same("  Nike  ", "NIKE");

    different("Straße", "STRASSE");
    different("ΟΔΟΣ", "οδοσ");
    different("İstanbul", "istanbul");
    different("Nike​X", "NikeX");
});

test("toBrandIdentity: display name is cleaned, the stored key is the shared key, and unstorable names are rejected", () => {
    assert.deepEqual(toBrandIdentity("  Expntl   Athletics "), { name: "Expntl Athletics", normalizedName: "expntl athletics" });
    assert.deepEqual(toBrandIdentity("nike"), { name: "nike", normalizedName: "nike" }, "the supplied casing is kept for display");
    assert.equal(toBrandIdentity("Nike")?.normalizedName, toBrandIdentity("NIKE")?.normalizedName);

    for (const bad of [undefined, null, 5, {}, "", "   ", "a\u0000b", "x".repeat(BRAND_MAX_LENGTH + 1)]) {
        assert.equal(toBrandIdentity(bad), null, JSON.stringify(bad));
    }
    assert.notEqual(toBrandIdentity("x".repeat(BRAND_MAX_LENGTH)), null, "exactly the limit is allowed");

    // NFKC can EXPAND a name: 6 x U+FDFA is 6 characters in, 108 out. Such a name has no storable key.
    const expanding = "ﷺ".repeat(6);
    assert.ok(expanding.length <= BRAND_MAX_LENGTH);
    assert.ok(normalizeBrandKey(expanding).length > BRAND_KEY_MAX_LENGTH);
    assert.equal(toBrandIdentity(expanding), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// ASCII BACKFILL EQUIVALENCE. The migration backfills with  translate(regexp_replace(btrim(name), ' +', ' ', 'g'), 'A-Z',
// 'a-z')  and only for printable ASCII. sqlBackfillKey is that expression in JavaScript. For every name it accepts it
// must equal the application key; the integration test checks the same corpus against real PostgreSQL 14 and 17.
// ---------------------------------------------------------------------------------------------------------------------
const PRINTABLE_ASCII = Array.from({ length: 95 }, (_, index) => String.fromCharCode(0x20 + index));

function* allStringsUpTo(length: number, alphabet: readonly string[]): Generator<string> {
    yield "";
    let layer = [""];
    for (let size = 1; size <= length; size += 1) {
        const next: string[] = [];
        for (const prefix of layer) for (const character of alphabet) next.push(prefix + character);
        for (const value of next) yield value;
        layer = next;
    }
}

test("ASCII backfill equivalence: EVERY printable-ASCII string up to length 3", () => {
    let supported = 0;
    for (const name of allStringsUpTo(3, PRINTABLE_ASCII)) {
        const sql = sqlBackfillKey(name);
        if (sql === null) {
            // Unsupported only because it is blank (all spaces) - never because of its content.
            assert.equal(name.trim(), "", `unexpectedly unsupported: ${JSON.stringify(name)}`);
            continue;
        }
        supported += 1;
        assert.equal(sql, normalizeBrandKey(name), JSON.stringify(name));
    }
    assert.ok(supported > 800_000, "the corpus is the whole space, not a sample");
});

// Small, fixed PRNG so the corpus is identical on every run and every machine.
function mulberry32(seed: number) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test("ASCII backfill equivalence: 40,000 seeded names with long space runs, mixed case and padding", () => {
    const random = mulberry32(20261105);
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_&.,'()";
    let compared = 0;

    for (let round = 0; round < 40_000; round += 1) {
        const length = 1 + Math.floor(random() * 60);
        let name = "";
        for (let index = 0; index < length; index += 1) {
            const roll = random();
            name += roll < 0.22 ? " ".repeat(1 + Math.floor(random() * 4)) : letters[Math.floor(random() * letters.length)];
        }

        const sql = sqlBackfillKey(name);
        if (sql === null) {
            assert.ok(sqlBackfillProblems(name).length > 0);
            continue;
        }
        assert.equal(sql, normalizeBrandKey(name), JSON.stringify(name));
        compared += 1;
    }
    assert.ok(compared > 30_000);
});

test("the SQL backfill refuses exactly the names it cannot key: non-ASCII, control characters, blank, over-long keys", () => {
    assert.deepEqual(sqlBackfillProblems("Nike"), []);
    assert.deepEqual(sqlBackfillProblems("Café"), ["not-ascii"]);
    assert.deepEqual(sqlBackfillProblems("a\tb"), ["control-character"]);
    assert.deepEqual(sqlBackfillProblems("a\u007Fb"), ["control-character"]);
    assert.deepEqual(sqlBackfillProblems("   "), ["blank"]);
    assert.deepEqual(sqlBackfillProblems(""), ["blank"]);
    assert.deepEqual(sqlBackfillProblems("x".repeat(101)), ["key-too-long"]);

    // The limit applies to the COLLAPSED key, not the raw text: 60 + 1 + 39 = 100 is fine even though the raw name is 105 long.
    const raw100 = `${"x".repeat(60)}      ${"y".repeat(39)}`;
    assert.equal(raw100.length, 105);
    assert.equal(sqlBackfillKey(raw100)?.length, 100);
    assert.deepEqual(sqlBackfillProblems(raw100), []);
    assert.deepEqual(sqlBackfillProblems(`${"x".repeat(60)}      ${"y".repeat(40)}`), ["key-too-long"], "a collapsed key of 101 is refused");
});
