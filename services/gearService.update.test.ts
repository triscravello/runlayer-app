import assert from "node:assert/strict";
import test from "node:test";

// End-to-end through the real service and repository, with a recording fake in place of Prisma (no database).
const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
const stored = {
    id: "g1", name: "Trail Tee", brandId: "b1", genderTarget: null, category: "TOP", subcategory: null, priceRange: "MID",
    tags: ["light"], bodyTypeFit: [], imageUrl: null, affiliateUrl: null, weatherHot: 0.4, weatherCold: 0.1, weatherRain: null, weatherWind: null,
    createdAt: new Date(0), updatedAt: new Date(0), brand: { id: "b1", name: "Acme" },
    variants: [{ id: "v1", gearItemId: "g1", createdAt: new Date(0), updatedAt: new Date(0), label: "Default", gender: "unisex", affiliateUrl: null, imageUrl: null, price: 20, sizes: ["M"] }],
};
(globalThis as unknown as { prisma: unknown }).prisma = {
    gearItem: {
        findMany: async () => [stored],
        update: async (args: (typeof updates)[number]) => { updates.push(args); return { id: args.where.id }; },
    },
};

test("admin PATCH without variants still succeeds: stored variant rows are re-created from their writable columns only", async () => {
    const { updateGearItem } = await import("./gearService");
    updates.length = 0;
    await updateGearItem("g1", { name: "  Trail Tee 2  " });

    assert.equal(updates.length, 1);
    const { data } = updates[0];
    assert.equal(data.name, "Trail Tee 2");
    assert.deepEqual(data.variants, { deleteMany: {}, create: [{ label: "Default", gender: "unisex", affiliateUrl: null, imageUrl: null, price: 20, sizes: ["M"] }] });
    for (const forbidden of ["id", "createdAt", "updatedAt", "brand", "OutfitItem", "RecommendationItem", "gearItemId"]) assert.equal(forbidden in data, false, forbidden);
});

test("admin PATCH with new variants and weather maps them explicitly", async () => {
    const { updateGearItem } = await import("./gearService");
    updates.length = 0;
    await updateGearItem("g1", { variants: [{ label: "Women", gender: "women", sizes: ["S"] }], weatherSuitability: { hot: 0.9, cold: null } });

    const { data } = updates[0];
    assert.deepEqual(data.variants, { deleteMany: {}, create: [{ label: "Women", gender: "women", affiliateUrl: undefined, imageUrl: undefined, price: undefined, sizes: ["S"] }] });
    assert.equal(data.weatherHot, 0.9);
    assert.equal(data.weatherCold, null);
});
