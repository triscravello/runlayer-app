import assert from "node:assert/strict";
import test from "node:test";

// Recommendation candidates are built from stored rows; an unsafe stored link must not survive the mapping, and the
// stored rows themselves must not be modified. Real repository and mapping against a fake Prisma (no database).
const row = (id: string, over: Record<string, unknown> = {}) => ({
    id, name: `Item ${id}`, brandId: "b1", genderTarget: null, category: "TOP", subcategory: null, priceRange: "MID", tags: [], bodyTypeFit: [],
    imageUrl: "https://example.com/i.png", affiliateUrl: null, weatherHot: 0.5, weatherCold: 0.5, weatherRain: 0.5, weatherWind: 0.5,
    createdAt: new Date(0), updatedAt: new Date(0), brand: { id: "b1", name: "Acme" }, variants: [], ...over,
});
const stored = [
    row("legacy", { affiliateUrl: "javascript:alert(1)", variants: [
        { id: "v1", label: "Men", gender: "men", affiliateUrl: "data:text/html,x", imageUrl: null, price: null, sizes: [] },
        { id: "v2", label: "Women", gender: "women", affiliateUrl: "https://example.com/buy", imageUrl: null, price: null, sizes: [] },
    ] }),
    row("fallback-only", { affiliateUrl: "ftp://example.com/x" }),
    row("clean", { affiliateUrl: "https://example.com/p", variants: [{ id: "v3", label: "Default", gender: "unisex", affiliateUrl: "https://example.com/p", imageUrl: null, price: null, sizes: [] }] }),
];
const snapshot = JSON.parse(JSON.stringify(stored));
(globalThis as unknown as { prisma: unknown }).prisma = { gearItem: { findMany: async () => stored } };

test("recommendation candidates carry no unsafe link, in the item, its variants or the selected variant", async () => {
    const { listGearRecommendationCandidates } = await import("./gearRepository");
    const candidates = await listGearRecommendationCandidates();
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));

    const legacy = byId.get("legacy")!;
    assert.equal(legacy.affiliateUrl, null);
    assert.deepEqual(legacy.variants?.map((variant) => variant.affiliateUrl), [null, "https://example.com/buy"]);
    assert.equal(legacy.selectedVariant?.affiliateUrl ?? null, null, "unisex-less item prefers the first variant, now without its link");

    assert.equal(byId.get("fallback-only")!.affiliateUrl, null);
    assert.equal(byId.get("fallback-only")!.selectedVariant?.affiliateUrl, "", "the fallback still exists, with no link");

    const clean = byId.get("clean")!;
    assert.equal(clean.affiliateUrl, "https://example.com/p");
    assert.equal(clean.selectedVariant?.affiliateUrl, "https://example.com/p");

    assert.equal(JSON.stringify(candidates).match(/javascript:|data:text|ftp:\/\//), null);
});

test("other candidate fields, scoring inputs and imageUrl are unchanged", async () => {
    const { listGearRecommendationCandidates } = await import("./gearRepository");
    const candidates = await listGearRecommendationCandidates();
    const legacy = candidates.find((candidate) => candidate.id === "legacy")!;
    assert.deepEqual(legacy.weatherSuitability, { hot: 0.5, warm: 0.5, cold: 0.5, rain: 0.5, wind: 0.5 });
    assert.equal(legacy.imageUrl, "https://example.com/i.png");
    assert.equal(legacy.brandName, "Acme");
    assert.equal(legacy.variants?.length, 2);
});

test("the stored rows are not modified", async () => {
    const { listGearRecommendationCandidates } = await import("./gearRepository");
    await listGearRecommendationCandidates();
    assert.deepEqual(JSON.parse(JSON.stringify(stored)), snapshot);
});
