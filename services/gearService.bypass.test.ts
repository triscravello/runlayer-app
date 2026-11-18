import assert from "node:assert/strict";
import test from "node:test";

// A caller that skips the route and its Zod schema and calls the service directly (as the importer does) must still be
// unable to push relation operations or protected columns into the Prisma update. Real service and repository; fake Prisma.
type Update = { where: { id: string }; data: Record<string, unknown> };
const updates: Update[] = [];
const stored = {
    id: "g1", name: "Trail Tee", brandId: "b1", genderTarget: null, category: "TOP", subcategory: null, priceRange: "MID",
    tags: [], bodyTypeFit: [], imageUrl: null, affiliateUrl: null, createdAt: new Date(0), updatedAt: new Date(0), brand: { id: "b1" }, variants: [],
};
(globalThis as unknown as { prisma: unknown }).prisma = {
    gearItem: { findMany: async () => [stored], findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, true> }) => (where.id === (stored as { id: string }).id ? Object.fromEntries(Object.keys(select).map((key) => [key, (stored as Record<string, unknown>)[key]])) : null), update: async (args: Update) => { updates.push(args); return { id: args.where.id }; } },
};

const ALLOWED = new Set(["name", "brandId", "genderTarget", "subcategory", "imageUrl", "affiliateUrl", "tags", "bodyTypeFit", "category", "priceRange", "variants", "weatherHot", "weatherCold", "weatherRain", "weatherWind"]);

const HOSTILE: Array<[string, Record<string, unknown>]> = [
    ["brand relation op", { brand: { connect: { id: "x" } } }],
    ["OutfitItem relation op", { OutfitItem: { deleteMany: {} } }],
    ["RecommendationItem relation op", { RecommendationItem: { deleteMany: {} } }],
    ["protected columns", { createdAt: new Date(1), updatedAt: new Date(1), weatherHot: 99, slug: "x", externalId: "e" }],
    ["body id differing from the argument", { id: "someone-else" }],
    ["brandId as relation object", { brandId: { connect: { id: "x" } } }],
    ["variants as raw operator object", { variants: { deleteMany: {}, create: [] } }],
    ["variant with relation field", { variants: [{ label: "a", gender: "men", gearItem: { connect: { id: "z" } } }] }],
    ["weather as operator", { weatherSuitability: { hot: { increment: 1 } } }],
    ["tags as operator", { tags: { push: "x" } }],
    ["category outside the enum", { category: "SHOES" }],
];

// Malformed shapes that used to be written (as a synthesized Default variant) or to crash with a TypeError: now always refused.
const MUST_REFUSE = new Set(["variants as raw operator object", "tags as operator", "brandId as relation object", "variant with relation field", "weather as operator", "category outside the enum"]);

for (const [label, hostile] of HOSTILE) {
    test(`service direct call cannot carry ${label} into the Prisma update`, async () => {
        const { updateGearItem } = await import("./gearService");
        updates.length = 0;
        let threw = false;
        try {
            await updateGearItem("g1", hostile as never);
        } catch {
            threw = true;
        }
        // Either refused outright, or written with only allowlisted keys, never the hostile ones, and always for the argument id.
        for (const update of updates) {
            assert.equal(update.where.id, "g1");
            for (const key of Object.keys(update.data)) assert.ok(ALLOWED.has(key), `unexpected key ${key}`);
            assert.equal(update.data.weatherHot, undefined);
            assert.equal(JSON.stringify(update.data).includes("connect"), false);
            assert.equal(JSON.stringify(update.data).includes("someone-else"), false);
            if (update.data.variants !== undefined) assert.deepEqual(Object.keys(update.data.variants as object).sort(), ["create", "deleteMany"]);
        }
        assert.ok(threw || updates.length === 1, "either refused or a single sanitized write");
        if (MUST_REFUSE.has(label)) {
            assert.equal(threw, true, "must be refused");
            assert.equal(updates.length, 0, "and nothing is written");
        }
    });
}
