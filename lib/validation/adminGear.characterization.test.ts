import assert from "node:assert/strict";
import test from "node:test";
import { createGearItemSchema, importGearItemsSchema } from "./adminGear";

// Characterization: pins the CURRENT output of the create/import schemas (defaults included) so the update-schema work
// cannot change them. Written before that work and expected to pass unchanged afterwards.

const MINIMAL = { name: "  Trail Tee ", brandId: " b1 ", category: "TOP", priceRange: "MID" };

test("create schema: minimal payload gets the documented defaults", () => {
    assert.deepEqual(createGearItemSchema.parse(MINIMAL), {
        name: "Trail Tee",
        brandId: "b1",
        category: "TOP",
        priceRange: "MID",
        tags: [],
        bodyTypeFit: [],
        imageUrl: null,
        affiliateUrl: null,
    });
});

test("create schema: full payload round-trips, nested defaults included", () => {
    const parsed = createGearItemSchema.parse({
        ...MINIMAL,
        id: " g1 ",
        externalId: " ext ",
        genderTarget: " men ",
        subcategory: null,
        tags: [" a "],
        bodyTypeFit: [],
        imageUrl: "https://example.com/i.png",
        affiliateUrl: null,
        variants: [{ label: " Default ", gender: "men" }, { label: "W", gender: "women", affiliateUrl: " x ", imageUrl: null, price: 5, sizes: [" S "] }],
        weatherSuitability: { hot: 0.5, cold: null },
    });
    assert.deepEqual(parsed, {
        name: "Trail Tee",
        brandId: "b1",
        category: "TOP",
        priceRange: "MID",
        id: "g1",
        externalId: "ext",
        genderTarget: "men",
        subcategory: null,
        tags: ["a"],
        bodyTypeFit: [],
        imageUrl: "https://example.com/i.png",
        affiliateUrl: null,
        variants: [
            { label: "Default", gender: "men", affiliateUrl: null, sizes: [] },
            { label: "W", gender: "women", affiliateUrl: "x", imageUrl: null, price: 5, sizes: ["S"] },
        ],
        weatherSuitability: { hot: 0.5, cold: null },
    });
});

test("create schema: unknown keys are still stripped, required fields still required", () => {
    assert.deepEqual(Object.keys(createGearItemSchema.parse({ ...MINIMAL, bogus: 1 })).sort(), ["affiliateUrl", "bodyTypeFit", "brandId", "category", "imageUrl", "name", "priceRange", "tags"]);
    assert.equal(createGearItemSchema.safeParse({ brandId: "b1", category: "TOP", priceRange: "MID" }).success, false);
    assert.equal(createGearItemSchema.safeParse({ ...MINIMAL, category: "SHOES" }).success, false);
});

test("import schema: array of create items, at least one", () => {
    assert.equal(importGearItemsSchema.safeParse([]).success, false);
    const parsed = importGearItemsSchema.parse([MINIMAL, { ...MINIMAL, name: "B" }]);
    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed[1].tags, []);
    assert.equal(parsed[1].imageUrl, null);
});
