import assert from "node:assert/strict";
import test from "node:test";
import { parseCreateOutfitRequest, parseOutfitId, parseUpdateOutfitRequest } from "./outfit";
import { KIT_TYPES, OUTFIT_DESCRIPTION_MAX_LENGTH, OUTFIT_ID_MAX_LENGTH, OUTFIT_MAX_GEAR_ITEMS, OUTFIT_NAME_MAX_LENGTH, normalizeKitType } from "./outfitLimits";

const SECRET = "SECRET-CLIENT-VALUE-9f3a";
const ids = (count: number) => Array.from({ length: count }, (_, index) => `gear-${index}`);
const validCreate = (overrides: Record<string, unknown> = {}) => ({ name: "Long run", gearItemIds: ["g1", "g2"], ...overrides });

function failure(result: { success: boolean; error?: string }) {
    assert.equal(result.success, false);
    return result.error as string;
}

// --- kit types ----------------------------------------------------------------------------------------------------

test("normalizeKitType accepts every supported type and the race_day alias, and nothing else", () => {
    for (const type of KIT_TYPES) assert.equal(normalizeKitType(type), type);
    assert.equal(normalizeKitType("race_day"), "race-day");
    assert.equal(normalizeKitType("  trail "), "trail");
    for (const bad of ["", "RACE-DAY", "marathon", "favourites", "race day"]) assert.equal(normalizeKitType(bad), null, bad);
});

// --- create -------------------------------------------------------------------------------------------------------

test("a valid create request parses and resolves the kit type", () => {
    const parsed = parseCreateOutfitRequest(validCreate({ category: "race_day", type: "trail", description: "x", isFavorite: true, recommendationId: "rec-1" }));
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.deepEqual(parsed.data, {
        recommendationId: "rec-1",
        name: "Long run",
        description: "x",
        isFavorite: true,
        gearItemIds: ["g1", "g2"],
        kitType: "race-day",
    });
});

test("category takes precedence over type, and type is used when category is absent or null", () => {
    const both = parseCreateOutfitRequest(validCreate({ category: "rain", type: "trail" }));
    const onlyType = parseCreateOutfitRequest(validCreate({ type: "trail" }));
    const nullCategory = parseCreateOutfitRequest(validCreate({ category: null, type: "summer" }));
    const neither = parseCreateOutfitRequest(validCreate());

    assert.equal(both.success && both.data.kitType, "rain");
    assert.equal(onlyType.success && onlyType.data.kitType, "trail");
    assert.equal(nullCategory.success && nullCategory.data.kitType, "summer");
    assert.equal(neither.success && neither.data.kitType, undefined);
});

test("create rejects a missing, empty, non-array, oversized or malformed gearItemIds list", () => {
    assert.equal(failure(parseCreateOutfitRequest({ name: "x" })), "Select at least one gear item.");
    assert.equal(failure(parseCreateOutfitRequest(validCreate({ gearItemIds: [] }))), "Select at least one gear item.");
    assert.equal(failure(parseCreateOutfitRequest(validCreate({ gearItemIds: null }))), "Gear items must be a list of ids.");
    assert.equal(failure(parseCreateOutfitRequest(validCreate({ gearItemIds: "g1,g2" }))), "Gear items must be a list of ids.");
    assert.equal(failure(parseCreateOutfitRequest(validCreate({ gearItemIds: ids(OUTFIT_MAX_GEAR_ITEMS + 1) }))), `A kit can contain at most ${OUTFIT_MAX_GEAR_ITEMS} gear items.`);

    assert.equal(parseCreateOutfitRequest(validCreate({ gearItemIds: ids(OUTFIT_MAX_GEAR_ITEMS) })).success, true, "exactly the limit is allowed");
});

test("gear ids must be non-blank strings of at most 64 characters", () => {
    for (const bad of [[""], ["   "], [5], [null], [{}], [["a"]], ["x".repeat(OUTFIT_ID_MAX_LENGTH + 1)]]) {
        assert.equal(failure(parseCreateOutfitRequest(validCreate({ gearItemIds: bad }))), "Invalid gear item id.", JSON.stringify(bad));
    }
    const ok = parseCreateOutfitRequest(validCreate({ gearItemIds: ["  g1  ", "x".repeat(OUTFIT_ID_MAX_LENGTH)] }));
    assert.equal(ok.success && ok.data.gearItemIds[0], "g1", "ids are trimmed");
});

test("create rejects non-object bodies with a controlled message", () => {
    for (const body of [null, undefined, 42, "text", true, [], [validCreate()]]) {
        assert.equal(failure(parseCreateOutfitRequest(body)), "Request body must be a JSON object.", JSON.stringify(body));
    }
});

test("unknown kit types are rejected, never coerced", () => {
    for (const bad of ["marathon", "", "FAVORITES", 5, {}, true]) {
        assert.equal(failure(parseCreateOutfitRequest(validCreate({ category: bad }))), "Unsupported kit type.", JSON.stringify(bad));
        assert.equal(failure(parseCreateOutfitRequest(validCreate({ type: bad }))), "Unsupported kit type.", JSON.stringify(bad));
    }
});

test("name, description, isFavorite and recommendationId are type- and length-checked", () => {
    assert.equal(parseCreateOutfitRequest(validCreate({ name: "n".repeat(OUTFIT_NAME_MAX_LENGTH) })).success, true);
    assert.match(failure(parseCreateOutfitRequest(validCreate({ name: "n".repeat(OUTFIT_NAME_MAX_LENGTH + 1) }))), /at most 120/);
    assert.equal(parseCreateOutfitRequest(validCreate({ description: "d".repeat(OUTFIT_DESCRIPTION_MAX_LENGTH) })).success, true);
    assert.match(failure(parseCreateOutfitRequest(validCreate({ description: "d".repeat(OUTFIT_DESCRIPTION_MAX_LENGTH + 1) }))), /at most 1000/);

    assert.equal(failure(parseCreateOutfitRequest(validCreate({ name: 5 }))), "Name must be text.");
    assert.equal(failure(parseCreateOutfitRequest(validCreate({ description: {} }))), "Description must be text.");
    assert.equal(failure(parseCreateOutfitRequest(validCreate({ isFavorite: "yes" }))), "isFavorite must be true or false.");
    assert.equal(failure(parseCreateOutfitRequest(validCreate({ recommendationId: 5 }))), "Invalid recommendation id.");
    assert.equal(failure(parseCreateOutfitRequest(validCreate({ recommendationId: "r".repeat(OUTFIT_ID_MAX_LENGTH + 1) }))), "Invalid recommendation id.");

    const nulls = parseCreateOutfitRequest(validCreate({ name: null, description: null, isFavorite: null, recommendationId: null }));
    assert.equal(nulls.success, true, "null is accepted for the optional fields");
});

test("unknown keys are stripped, so a client cannot inject an owner or id", () => {
    const parsed = parseCreateOutfitRequest(validCreate({ userId: "someone-else", id: "forced-id", createdAt: "2000-01-01" }));
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal("userId" in parsed.data, false);
    assert.equal("id" in parsed.data, false);
    assert.equal("createdAt" in parsed.data, false);
});

test("validation messages never echo the offending value", () => {
    const attempts: Array<[string, unknown]> = [
        ["gear id", { gearItemIds: [SECRET.repeat(10)] }],
        ["kit type", { category: SECRET }],
        ["name", { name: SECRET.repeat(20) }],
        ["description", { description: SECRET.repeat(100) }],
        ["recommendation", { recommendationId: SECRET.repeat(10) }],
        ["isFavorite", { isFavorite: SECRET }],
        ["gear list", { gearItemIds: SECRET }],
    ];
    for (const [label, overrides] of attempts) {
        const message = failure(parseCreateOutfitRequest(validCreate(overrides as Record<string, unknown>)));
        assert.doesNotMatch(message, new RegExp(SECRET), label);
    }
    assert.doesNotMatch(failure(parseCreateOutfitRequest(SECRET)), new RegExp(SECRET));
});

// --- update -------------------------------------------------------------------------------------------------------

test("update accepts any subset of fields, including none", () => {
    assert.equal(parseUpdateOutfitRequest({}).success, true);
    const parsed = parseUpdateOutfitRequest({ name: "New", isFavorite: false });
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.gearItemIds, undefined);
    assert.equal(parsed.data.kitType, undefined);
});

test("update treats absent or null gearItemIds as 'leave the items alone' but rejects an empty list", () => {
    const absent = parseUpdateOutfitRequest({ name: "x" });
    const nulled = parseUpdateOutfitRequest({ gearItemIds: null });
    assert.equal(absent.success && absent.data.gearItemIds, undefined);
    assert.equal(nulled.success && nulled.data.gearItemIds, null);

    assert.equal(failure(parseUpdateOutfitRequest({ gearItemIds: [] })), "Select at least one gear item.");
    assert.equal(failure(parseUpdateOutfitRequest({ gearItemIds: ids(OUTFIT_MAX_GEAR_ITEMS + 1) })), `A kit can contain at most ${OUTFIT_MAX_GEAR_ITEMS} gear items.`);
    assert.equal(failure(parseUpdateOutfitRequest({ gearItemIds: [""] })), "Invalid gear item id.");
});

test("update rejects non-object bodies, malformed types and unknown kit types", () => {
    for (const body of [null, 5, "x", []]) assert.equal(failure(parseUpdateOutfitRequest(body)), "Request body must be a JSON object.");
    assert.equal(failure(parseUpdateOutfitRequest({ name: 123 })), "Name must be text.");
    assert.equal(failure(parseUpdateOutfitRequest({ isFavorite: "x" })), "isFavorite must be true or false.");
    assert.equal(failure(parseUpdateOutfitRequest({ type: "marathon" })), "Unsupported kit type.");
    assert.equal(parseUpdateOutfitRequest({ type: "race_day" }).success, true, "legacy alias is still supported");
});

test("update ignores recommendationId (the client still sends it) and cannot change the owner", () => {
    const parsed = parseUpdateOutfitRequest({ recommendationId: "rec-1", userId: "someone-else", name: "x" });
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal("recommendationId" in parsed.data, false);
    assert.equal("userId" in parsed.data, false);
});

// --- identifiers --------------------------------------------------------------------------------------------------

test("parseOutfitId accepts bounded non-blank strings only", () => {
    assert.equal(parseOutfitId(" abc "), "abc");
    assert.equal(parseOutfitId("x".repeat(OUTFIT_ID_MAX_LENGTH)), "x".repeat(OUTFIT_ID_MAX_LENGTH));
    for (const bad of [null, undefined, "", "   ", 5, {}, "x".repeat(OUTFIT_ID_MAX_LENGTH + 1)]) assert.equal(parseOutfitId(bad), null, JSON.stringify(bad));
});
