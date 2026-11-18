import assert from "node:assert/strict";
import test from "node:test";
import { createRecordingGearClient } from "../test-support/gearStoreFake";

// End-to-end through the real service and repository, with a recording fake in place of Prisma (no database).
const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
const stored = {
    id: "g1", name: "Trail Tee", brandId: "b1", genderTarget: null, category: "TOP", subcategory: null, priceRange: "MID",
    tags: ["light"], bodyTypeFit: [], imageUrl: null, affiliateUrl: null, weatherHot: 0.4, weatherCold: 0.1, weatherRain: null, weatherWind: null,
    createdAt: new Date(0), updatedAt: new Date(0), brand: { id: "b1", name: "Acme" },
    variants: [{ id: "v1", gearItemId: "g1", createdAt: new Date(0), updatedAt: new Date(0), label: "Default", gender: "unisex", affiliateUrl: null, imageUrl: null, price: 20, sizes: ["M"] }],
};
(globalThis as unknown as { prisma: unknown }).prisma = {
    $transaction: createRecordingGearClient(updates as never, (id) => (id === stored.id ? (stored as never) : null)).$transaction,
    gearItem: {
        findMany: async () => [stored],
        findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, true> }) => (where.id === stored.id ? Object.fromEntries(Object.keys(select).map((key) => [key, (stored as Record<string, unknown>)[key]])) : null),
    },
};

test("admin PATCH without variants leaves the stored variants (and their ids) untouched", async () => {
    const { updateGearItem } = await import("./gearService");
    updates.length = 0;
    await updateGearItem("g1", { name: "  Trail Tee 2  " });

    assert.equal(updates.length, 1);
    const { data } = updates[0];
    assert.equal(data.name, "Trail Tee 2");
    assert.equal("variants" in data, false, "no variants operation is sent when the caller sent none");
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

// --- PATCH-defaults regression: omitted fields survive, explicit clears apply -------------------------------------

test("PATCH {name} writes only the name: no stored or default values are written for omitted fields", async () => {
    const { updateGearItem } = await import("./gearService");
    updates.length = 0;
    await updateGearItem("g1", { name: "Renamed" });

    const { data } = updates[0];
    assert.equal(data.name, "Renamed");
    assert.deepEqual(Object.keys(data), ["name"]);
});

test("explicit clears apply to that field only", async () => {
    const { updateGearItem } = await import("./gearService");
    updates.length = 0;
    await updateGearItem("g1", { tags: [], genderTarget: null });

    assert.deepEqual(updates[0].data.tags, []);
    assert.equal(updates[0].data.genderTarget, null);
    assert.deepEqual(Object.keys(updates[0].data).sort(), ["genderTarget", "tags"], "only the cleared fields are written");
});

test("a partial weatherSuitability writes only the scores that were sent", async () => {
    const { updateGearItem } = await import("./gearService");
    updates.length = 0;
    await updateGearItem("g1", { weatherSuitability: { hot: 0.3 } });

    const { data } = updates[0];
    assert.equal(data.weatherHot, 0.3);
    for (const column of ["weatherCold", "weatherRain", "weatherWind"]) assert.equal(data[column], undefined, `${column} must not be written`);
});

test("variants: [] keeps its existing meaning (Default synthesized); supplied variants replace exactly", async () => {
    const { updateGearItem } = await import("./gearService");
    updates.length = 0;
    await updateGearItem("g1", { variants: [] });
    assert.deepEqual((updates[0].data.variants as { create: Array<{ label: string }> }).create.map((variant) => variant.label), ["Default"]);

    await updateGearItem("g1", { variants: [{ label: "A", gender: "men" }, { label: "B", gender: "women" }] });
    assert.deepEqual((updates[1].data.variants as { create: Array<{ label: string }> }).create.map((variant) => variant.label), ["A", "B"]);
});
