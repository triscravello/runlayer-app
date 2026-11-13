import assert from "node:assert/strict";
import test from "node:test";
import { updateGearItemSchema } from "./adminGear";

const FIELD_SAMPLES: Record<string, unknown> = {
    name: "Tee", brandId: "b1", category: "TOP", priceRange: "MID", genderTarget: "men", subcategory: "tee", tags: ["a"], bodyTypeFit: ["slim"],
    imageUrl: "https://example.com/i.png", affiliateUrl: "https://example.com/buy",
    variants: [{ label: "Default", gender: "unisex" }], weatherSuitability: { hot: 0.5 },
};

test("a field that is not sent is not in the parsed output (no defaults leak into a PATCH)", () => {
    for (const [field, value] of Object.entries(FIELD_SAMPLES)) {
        const parsed = updateGearItemSchema.parse({ [field]: value });
        assert.deepEqual(Object.keys(parsed), [field], `only ${field} may appear`);
    }
});

test("a partial PATCH parses to exactly what was sent", () => {
    assert.deepEqual(updateGearItemSchema.parse({ name: " New " }), { name: "New" });
    assert.deepEqual(updateGearItemSchema.parse({ weatherSuitability: { hot: 0.3 } }), { weatherSuitability: { hot: 0.3 } });
});

test("explicit clears are accepted and preserved", () => {
    const clears = { genderTarget: null, subcategory: null, imageUrl: null, affiliateUrl: null, tags: [], bodyTypeFit: [] };
    for (const [field, value] of Object.entries(clears)) assert.deepEqual(updateGearItemSchema.parse({ [field]: value }), { [field]: value });
    for (const score of ["hot", "cold", "rain", "wind"]) assert.deepEqual(updateGearItemSchema.parse({ weatherSuitability: { [score]: null } }), { weatherSuitability: { [score]: null } });
});

test("variants: [] is accepted (its meaning is decided by the service)", () => {
    assert.deepEqual(updateGearItemSchema.parse({ variants: [] }), { variants: [] });
});

test("empty or non-meaningful bodies are rejected", () => {
    const rejected: unknown[] = [{}, { id: "g1" }, { externalId: "e" }, { id: "g1", externalId: "e" }, { weatherSuitability: {} }, [], null, "x", 5];
    for (const body of rejected) assert.equal(updateGearItemSchema.safeParse(body).success, false, JSON.stringify(body));
});

test("id and externalId alongside a real change are accepted", () => {
    assert.deepEqual(updateGearItemSchema.parse({ id: "g1", externalId: "e", name: "x" }), { id: "g1", externalId: "e", name: "x" });
});

test("unknown fields are rejected, at the top level and in nested objects", () => {
    const rejected: unknown[] = [
        { name: "x", bogus: 1 }, { brand: { connect: { id: "x" } } }, { OutfitItem: { deleteMany: {} } }, { createdAt: "2020-01-01" }, { weatherHot: 1 },
        { weatherSuitability: { hot: 1, snow: 1 } },
        { variants: [{ label: "a", gender: "men", gearItem: { connect: { id: "z" } } }] },
        { variants: [{ label: "a", gender: "men", id: "v1" }] },
        JSON.parse('{"constructor":{"prototype":{"y":1}},"name":"z"}'),
    ];
    for (const body of rejected) assert.equal(updateGearItemSchema.safeParse(body).success, false, JSON.stringify(body));
});

test("an own __proto__ key is dropped by Zod 4 (not rejected): no pollution, and it never reaches the output", () => {
    const parsed = updateGearItemSchema.parse(JSON.parse('{"__proto__":{"polluted":1},"name":"z"}'));
    assert.deepEqual(parsed, { name: "z" });
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "__proto__"), false);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("invalid values are still rejected", () => {
    const rejected: unknown[] = [
        { name: 5 }, { name: "  " }, { name: null }, { brandId: { connect: { id: "x" } } }, { category: "SHOES" }, { priceRange: null }, { tags: { push: "x" } }, { tags: [1] }, { tags: [" "] },
        { variants: { deleteMany: {} } }, { variants: [{ label: "a", gender: "kids" }] }, { variants: [{ label: "a", gender: "men", price: -1 }] }, { variants: [{ label: " ", gender: "men" }] },
        { weatherSuitability: { hot: { increment: 1 } } }, { weatherSuitability: { hot: 2 } }, { weatherSuitability: null },
        { imageUrl: "javascript:alert(1)" }, { imageUrl: "" }, { affiliateUrl: "not a url" }, { subcategory: 5 },
    ];
    for (const body of rejected) assert.equal(updateGearItemSchema.safeParse(body).success, false, JSON.stringify(body));
});
