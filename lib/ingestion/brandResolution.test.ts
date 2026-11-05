import assert from "node:assert/strict";
import test from "node:test";
import {
    BRAND_FAILURE,
    BRAND_MAX_LENGTH,
    checkBrandText,
    cleanBrandName,
    normalizeBrandKey,
    planBrandResolution,
    type BrandRecord,
    type BrandReference,
} from "./brandResolution";

const NIKE: BrandRecord = { id: "00000000-0000-4000-8000-000000000001", name: "Nike" };
const BROOKS: BrandRecord = { id: "00000000-0000-4000-8000-000000000002", name: "Brooks" };
const byName = (name: string): BrandReference => ({ id: null, name });
const byId = (id: string): BrandReference => ({ id, name: null });

test("normalizeBrandKey ignores case, surrounding and repeated whitespace, and compatibility forms", () => {
    assert.equal(normalizeBrandKey("  NIKE "), "nike");
    assert.equal(normalizeBrandKey("Expntl   Athletics"), "expntl athletics");
    assert.equal(normalizeBrandKey("Expntl\tAthletics"), "expntl athletics");
    assert.equal(normalizeBrandKey("ＮＩＫＥ"), "nike", "full-width letters fold to ASCII under NFKC");
});

test("cleanBrandName keeps the supplied casing and only trims and collapses whitespace", () => {
    assert.equal(cleanBrandName("  nike  "), "nike");
    assert.equal(cleanBrandName("Expntl   Athletics"), "Expntl Athletics");
});

test("checkBrandText rejects non-strings, blanks, control characters and over-long values", () => {
    assert.deepEqual(checkBrandText(" Nike "), { ok: true, value: "Nike" });
    for (const bad of [undefined, null, 5, {}, [], "", "   ", "a\u0000b", "a\nb", "x".repeat(BRAND_MAX_LENGTH + 1)]) {
        assert.equal(checkBrandText(bad).ok, false, `rejects ${JSON.stringify(bad)}`);
    }
    assert.equal(checkBrandText("x".repeat(BRAND_MAX_LENGTH)).ok, true);
});

test("an existing brand is reused case-insensitively and nothing is created", () => {
    const plan = planBrandResolution([NIKE, BROOKS], [byName("nike"), byName(" BROOKS ")], "create-missing");
    assert.deepEqual(plan.outcomes, [
        { status: "resolved", brandId: NIKE.id },
        { status: "resolved", brandId: BROOKS.id },
    ]);
    assert.deepEqual(plan.toCreate, []);
});

test("a missing brand is planned for creation with its supplied display name (create-missing)", () => {
    const plan = planBrandResolution([], [byName("  nike ")], "create-missing");
    assert.deepEqual(plan.outcomes, [{ status: "create", key: "nike", name: "nike" }]);
    assert.deepEqual(plan.toCreate, ["nike"]);
});

test("a missing brand is rejected, never planned, under require-existing (admin policy)", () => {
    const plan = planBrandResolution([NIKE], [byName("adidas")], "require-existing");
    assert.deepEqual(plan.outcomes, [{ status: "failed", reason: BRAND_FAILURE.unknownBrand }]);
    assert.deepEqual(plan.toCreate, []);
});

test("an explicit id must exist; it never creates and never falls back to the name", () => {
    const plan = planBrandResolution([NIKE], [{ id: "nike", name: "Nike" }, byId(NIKE.id)], "create-missing");
    assert.deepEqual(plan.outcomes, [
        { status: "failed", reason: BRAND_FAILURE.unknownId },
        { status: "resolved", brandId: NIKE.id },
    ]);
    assert.deepEqual(plan.toCreate, []);
});

test("a brand name is never returned as a brand id", () => {
    const plan = planBrandResolution([NIKE], [byName("nike"), byName("adidas")], "create-missing");
    for (const outcome of plan.outcomes) {
        if (outcome.status === "resolved") assert.match(outcome.brandId, /^[0-9a-f-]{36}$/);
        else assert.equal("brandId" in outcome, false);
    }
});

test("id and name that agree resolve; id and name that disagree conflict", () => {
    const plan = planBrandResolution(
        [NIKE, BROOKS],
        [{ id: NIKE.id, name: "NIKE" }, { id: NIKE.id, name: "Brooks" }, { id: NIKE.id, name: "Adidas" }],
        "create-missing",
    );
    assert.deepEqual(plan.outcomes, [
        { status: "resolved", brandId: NIKE.id },
        { status: "failed", reason: BRAND_FAILURE.conflict },
        { status: "failed", reason: BRAND_FAILURE.conflict },
    ]);
    assert.deepEqual(plan.toCreate, [], "a conflicting name must not be created");
});

test("existing brands that share a normalized key are ambiguous, never guessed", () => {
    const upper: BrandRecord = { id: "00000000-0000-4000-8000-000000000009", name: "NIKE" };
    const plan = planBrandResolution([NIKE, upper], [byName("nike")], "create-missing");
    assert.deepEqual(plan.outcomes, [{ status: "failed", reason: BRAND_FAILURE.ambiguous }]);
    assert.deepEqual(plan.toCreate, []);
});

test("an explicit id still resolves when its name is ambiguous", () => {
    const upper: BrandRecord = { id: "00000000-0000-4000-8000-000000000009", name: "NIKE" };
    const plan = planBrandResolution([NIKE, upper], [byId(upper.id)], "create-missing");
    assert.deepEqual(plan.outcomes, [{ status: "resolved", brandId: upper.id }]);
});

test("malformed references fail individually with fixed reasons", () => {
    const refs = [
        { id: null, name: null },
        { id: "   ", name: null },
        { id: null, name: "a\u0007b" },
        { id: null, name: "x".repeat(500) },
        { id: 42 as unknown as string, name: null },
        { id: null, name: {} as unknown as string },
        byName("nike"),
    ];
    const plan = planBrandResolution([NIKE], refs, "create-missing");
    assert.deepEqual(
        plan.outcomes.map((outcome) => (outcome.status === "failed" ? outcome.reason : outcome.status)),
        [
            BRAND_FAILURE.required,
            BRAND_FAILURE.invalidId,
            BRAND_FAILURE.invalidName,
            BRAND_FAILURE.invalidName,
            BRAND_FAILURE.invalidId,
            BRAND_FAILURE.invalidName,
            "resolved",
        ],
    );
});

test("creation plan is deduplicated, sorted by key and independent of row order", () => {
    const forward = planBrandResolution([], [byName("Zed"), byName("alpha"), byName("ALPHA"), byName("Alpha"), byName("mid")], "create-missing");
    const reversed = planBrandResolution([], [byName("mid"), byName("Alpha"), byName("ALPHA"), byName("alpha"), byName("Zed")], "create-missing");

    assert.deepEqual(forward.toCreate, ["ALPHA", "mid", "Zed"], "one name per key (smallest spelling), ordered by key");
    assert.deepEqual(forward.toCreate, reversed.toCreate);
});

test("planning is a pure function of its inputs", () => {
    const refs = [byName("nike"), byName("adidas"), byId("nope")];
    const brands = [NIKE, BROOKS];
    assert.deepEqual(planBrandResolution(brands, refs, "create-missing"), planBrandResolution(brands, refs, "create-missing"));
    assert.deepEqual(brands, [NIKE, BROOKS], "inputs are not mutated");
});
