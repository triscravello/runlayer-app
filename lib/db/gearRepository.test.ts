import assert from "node:assert/strict";
import test from "node:test";
import { buildGearUpdateData, InvalidGearUpdateError, updateGearItem, type GearWriter } from "./gearRepository";

type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };

function fakeWriter() {
    const updates: UpdateArgs[] = [];
    const writer = { gearItem: { update: async (args: UpdateArgs) => { updates.push(args); return { id: args.where.id }; } } } as unknown as GearWriter;
    return { writer, updates };
}

const LEGIT = {
    id: "g1",
    name: "Trail Tee",
    brandId: "b1",
    category: "TOP",
    priceRange: "MID",
    genderTarget: null,
    subcategory: "tee",
    tags: ["light"],
    bodyTypeFit: ["slim"],
    imageUrl: "https://example.com/i.png",
    affiliateUrl: null,
    variants: [{ label: "Default", gender: "unisex", affiliateUrl: null, imageUrl: undefined, price: 20, sizes: ["M"] }],
    weatherSuitability: { hot: 0.5, cold: null, rain: 0.2, wind: undefined },
};

test("legitimate admin update maps to the same Prisma data as before", async () => {
    const { writer, updates } = fakeWriter();
    await updateGearItem(LEGIT as never, writer);

    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].where, { id: "g1" });
    assert.deepEqual(updates[0].data, {
        name: "Trail Tee",
        brandId: "b1",
        genderTarget: null,
        subcategory: "tee",
        imageUrl: "https://example.com/i.png",
        affiliateUrl: null,
        tags: ["light"],
        bodyTypeFit: ["slim"],
        category: "TOP",
        priceRange: "MID",
        variants: { deleteMany: {}, create: [{ label: "Default", gender: "unisex", affiliateUrl: null, imageUrl: undefined, price: 20, sizes: ["M"] }] },
        weatherHot: 0.5,
        weatherCold: null,
        weatherRain: 0.2,
        weatherWind: undefined,
    });
});

test("legacy `warm` alias still feeds weatherHot; omitted weather leaves columns untouched", () => {
    assert.equal((buildGearUpdateData({ id: "g1", weatherSuitability: { warm: 0.7 } }).data as Record<string, unknown>).weatherHot, 0.7);
    const noWeather = buildGearUpdateData({ id: "g1", name: "x" }).data as Record<string, unknown>;
    for (const key of ["weatherHot", "weatherCold", "weatherRain", "weatherWind", "variants"]) assert.equal(key in noWeather, false);
});

const REJECTED: Array<[string, Record<string, unknown>]> = [
    ["nested brand relation op", { id: "g1", brand: { connect: { id: "x" } } }],
    ["OutfitItem relation op", { id: "g1", OutfitItem: { deleteMany: {} } }],
    ["RecommendationItem relation op", { id: "g1", RecommendationItem: { deleteMany: {} } }],
    ["raw weather column", { id: "g1", weatherHot: 99 }],
    ["createdAt", { id: "g1", createdAt: new Date(0) }],
    ["updatedAt", { id: "g1", updatedAt: new Date(0) }],
    ["unknown field", { id: "g1", isAdmin: true }],
    ["brandId as relation object", { id: "g1", brandId: { set: "x" } }],
    ["id as object", { id: { not: "x" } }],
    ["missing id", { name: "x" }],
    ["variants as raw Prisma operator", { id: "g1", variants: { deleteMany: {}, create: [] } }],
    ["variant with relation field", { id: "g1", variants: [{ label: "a", gender: "men", gearItem: { connect: { id: "z" } } }] }],
    ["variant price as operator", { id: "g1", variants: [{ label: "a", gender: "men", price: { increment: 1 } }] }],
    ["variant sizes as operator", { id: "g1", variants: [{ label: "a", gender: "men", sizes: { push: "x" } }] }],
    ["weather unknown key", { id: "g1", weatherSuitability: { hot: 1, snow: 1 } }],
    ["weather as operator", { id: "g1", weatherSuitability: { hot: { increment: 1 } } }],
    ["weather NaN", { id: "g1", weatherSuitability: { hot: Number.NaN } }],
    ["unsupported category", { id: "g1", category: "SHOES" }],
    ["unsupported priceRange", { id: "g1", priceRange: "FREE" }],
    ["tags as operator", { id: "g1", tags: { push: "x" } }],
    ["empty name", { id: "g1", name: "  " }],
];

for (const [label, payload] of REJECTED) {
    test(`rejected without any write: ${label}`, async () => {
        const { writer, updates } = fakeWriter();
        await assert.rejects(updateGearItem(payload as never, writer), InvalidGearUpdateError);
        assert.equal(updates.length, 0);
    });
}

test("non-object payloads are rejected", () => {
    for (const bad of [null, undefined, "x", 1, [], [{ id: "g1" }]]) assert.throws(() => buildGearUpdateData(bad), InvalidGearUpdateError);
});

test("output never contains keys outside the column allowlist", () => {
    const { data } = buildGearUpdateData(LEGIT);
    const allowed = new Set(["name", "brandId", "genderTarget", "subcategory", "imageUrl", "affiliateUrl", "tags", "bodyTypeFit", "category", "priceRange", "variants", "weatherHot", "weatherCold", "weatherRain", "weatherWind"]);
    for (const key of Object.keys(data)) assert.ok(allowed.has(key), key);
    assert.deepEqual(Object.keys((data as { variants: object }).variants).sort(), ["create", "deleteMany"]);
});

test("a stored variant row echoed back has its read-only columns dropped, never written", () => {
    const stored = { id: "v1", gearItemId: "g1", createdAt: new Date(0), updatedAt: new Date(0), label: "Default", gender: "unisex", affiliateUrl: null, imageUrl: null, price: null, sizes: [] };
    const { data } = buildGearUpdateData({ id: "g1", variants: [stored] });
    assert.deepEqual((data as { variants: { create: unknown[] } }).variants.create, [{ label: "Default", gender: "unisex", affiliateUrl: null, imageUrl: null, price: null, sizes: [] }]);
});

test("variant relation fields are still rejected", () => {
    assert.throws(() => buildGearUpdateData({ id: "g1", variants: [{ label: "a", gender: "men", gearItem: { connect: { id: "z" } } }] }), InvalidGearUpdateError);
});
