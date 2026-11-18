import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentRecommendationEngineMetadata } from "../engine/versioning/versionMetadata";

// Recommendation candidates (the objects the recommendation routes serialize and the compare page passes to the browser) must not carry
// the gear row's internal `version` counter. Fake Prisma only; the fixture rows are deep-frozen so any in-place mutation would throw.
function deepFreeze<T>(value: T): T {
    if (value && typeof value === "object" && !(value instanceof Date)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
}
const date = new Date("2026-01-01T00:00:00.000Z");
const rows = deepFreeze([
    {
        id: "g1", name: "Tee", brandId: "b1", genderTarget: "men", category: "TOP", subcategory: "tee", priceRange: "MID", tags: ["light"], bodyTypeFit: ["slim"],
        imageUrl: "https://shop.example.com/i.png", affiliateUrl: "javascript:legacy", weatherHot: 0.8, weatherCold: null, weatherRain: 0.2, weatherWind: 0.3,
        createdAt: date, updatedAt: date, version: 7, internalNote: "item-note",
        brand: { id: "b1", name: "Acme", version: 3 },
        variants: [
            { id: "v1", gearItemId: "g1", label: "Men", gender: "male", affiliateUrl: "https://shop.example.com/m", imageUrl: null, price: 20, sizes: ["M"], createdAt: date, updatedAt: date },
            { id: "v2", gearItemId: "g1", label: "Women", gender: "women", affiliateUrl: "data:text/html,x", imageUrl: null, price: null, sizes: [], createdAt: date, updatedAt: date },
        ],
    },
    { id: "g2", name: "Shorts", brandId: "b1", genderTarget: null, category: "BOTTOM", subcategory: null, priceRange: "BUDGET", tags: [], bodyTypeFit: [], imageUrl: null, affiliateUrl: null, weatherHot: null, weatherCold: null, weatherRain: null, weatherWind: null, createdAt: date, updatedAt: date, version: 0, brand: { id: "b1", name: "Acme" }, variants: [] },
]);
(globalThis as unknown as { prisma: unknown }).prisma = { gearItem: { findMany: async () => rows } };

const hasKey = (value: unknown, key: string): boolean => Array.isArray(value) ? value.some((entry) => hasKey(entry, key)) : value instanceof Date ? false : typeof value === "object" && value !== null ? Object.entries(value).some(([name, entry]) => name === key || hasKey(entry, key)) : false;

test("candidates carry no gear `version`, including a version of 0 and a nested brand version, and nothing else is lost", async () => {
    const { listGearRecommendationCandidates } = await import("./gearRepository");
    const candidates = await listGearRecommendationCandidates();
    assert.equal(candidates.length, 2);
    // `version` is gone at the top level (the only place the gear row has it for candidates).
    for (const candidate of candidates) assert.equal("version" in candidate, false);
    // Every other column of the row is still there with the same value.
    for (const [row, candidate] of rows.map((row, index) => [row, candidates[index]] as const)) {
        for (const [key, value] of Object.entries(row)) {
            if (key === "version" || key === "variants" || key === "affiliateUrl") continue;
            assert.deepEqual((candidate as unknown as Record<string, unknown>)[key], value, `${row.id}.${key} is unchanged`);
        }
    }
});

test("derived properties, scoring inputs, selected variant and containment are unchanged", async () => {
    const { listGearRecommendationCandidates } = await import("./gearRepository");
    const [tee, shorts] = await listGearRecommendationCandidates();
    assert.deepEqual(tee.weatherSuitability, { hot: 0.8, warm: 0.8, cold: 0, rain: 0.2, wind: 0.3 });
    assert.deepEqual(shorts.weatherSuitability, { hot: 0, warm: 0, cold: 0, rain: 0, wind: 0 });
    assert.equal(tee.brandName, "Acme");
    assert.equal(tee.affiliateUrl, null, "the unsafe item link is contained");
    assert.deepEqual(tee.variants?.map((variant) => [variant.label, variant.gender, variant.affiliateUrl]), [["Men", "men", "https://shop.example.com/m"], ["Women", "women", null]]);
    assert.ok(tee.selectedVariant, "a variant is still selected");
    assert.equal(hasKey(tee.selectedVariant, "version"), false);
    assert.deepEqual(shorts.variants, []);
});

test("the stored rows are not modified (they are frozen, so an in-place edit would have thrown)", async () => {
    const { listGearRecommendationCandidates } = await import("./gearRepository");
    await listGearRecommendationCandidates();
    assert.equal(rows[0].version, 7);
    assert.equal(rows[0].brand.version, 3, "the brand's own columns are not this mapper's concern");
});

test("the recommendation engine's own versionMetadata.version is a different thing and is untouched", () => {
    const metadata = getCurrentRecommendationEngineMetadata();
    assert.equal(typeof metadata.version, "string", "an engine release string such as 1.0.0, not a gear row counter");
    assert.match(metadata.version, /^\d+\.\d+\.\d+$/);
});
