import assert from "node:assert/strict";
import test from "node:test";

// Characterization of behavior the PATCH-defaults fix must NOT change: the importer's full-row upsert and the
// `variants: []` rule. Runs the real service and repository against a recording fake in place of Prisma (no database).
type Call = { where?: { id: string }; data: Record<string, unknown> };
const updates: Call[] = [];
const creates: Call[] = [];
const stored = {
    id: "g1", name: "Trail Tee", brandId: "b1", genderTarget: "men", category: "TOP", subcategory: null, priceRange: "MID",
    tags: ["light"], bodyTypeFit: ["slim"], imageUrl: "https://example.com/stored.png", affiliateUrl: "https://example.com/buy",
    weatherHot: 0.4, weatherCold: 0.1, weatherRain: null, weatherWind: null, createdAt: new Date(0), updatedAt: new Date(0),
    brand: { id: "b1", name: "Acme" }, variants: [],
};
(globalThis as unknown as { prisma: unknown }).prisma = {
    gearItem: {
        findMany: async () => [stored],
        update: async (args: Call) => { updates.push(args); return { id: args.where?.id }; },
        create: async (args: Call) => { creates.push(args); return { id: "new" }; },
    },
};

test("importer upsert of an existing item rewrites the full row, defaults included", async () => {
    const { upsertGearItem } = await import("./gearService");
    updates.length = 0;
    const result = await upsertGearItem({ name: "Trail Tee", brandId: "b1", category: "TOP", priceRange: "MID", affiliateUrl: null, tags: [], bodyTypeFit: [], imageUrl: null });

    assert.equal(result.action, "updated");
    assert.equal(updates.length, 1);
    const { data } = updates[0];
    assert.deepEqual(
        { name: data.name, tags: data.tags, bodyTypeFit: data.bodyTypeFit, imageUrl: data.imageUrl, affiliateUrl: data.affiliateUrl, genderTarget: data.genderTarget },
        { name: "Trail Tee", tags: [], bodyTypeFit: [], imageUrl: null, affiliateUrl: null, genderTarget: null },
    );
    // No variants supplied by the importer: a Default variant is synthesized and the stored set is replaced.
    assert.deepEqual(data.variants, { deleteMany: {}, create: [{ label: "Default", gender: "unisex", affiliateUrl: null, imageUrl: null, price: undefined, sizes: [] }] });
});

test("importer upsert of a new item creates it", async () => {
    const { upsertGearItem } = await import("./gearService");
    creates.length = 0;
    const result = await upsertGearItem({ name: "Brand New", brandId: "b1", category: "TOP", priceRange: "MID", affiliateUrl: null });
    assert.equal(result.action, "inserted");
    assert.equal(creates.length, 1);
});

test("variants: [] keeps its current meaning: a Default variant is synthesized from the item's own URLs", async () => {
    const { updateGearItem } = await import("./gearService");
    updates.length = 0;
    await updateGearItem("g1", { variants: [] });

    assert.deepEqual(updates[0].data.variants, {
        deleteMany: {},
        create: [{ label: "Default", gender: "unisex", affiliateUrl: "https://example.com/buy", imageUrl: "https://example.com/stored.png", price: undefined, sizes: [] }],
    });
});
