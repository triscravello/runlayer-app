import assert from "node:assert/strict";
import test from "node:test";
import type { getRecommendationHistory } from "@/services/recommendationServerService";
import type { getSavedOutfitById, listSavedOutfitsByUserId } from "@/services/savedOutfitServerService";
import { CLIENT_GEAR_BRAND_KEYS, CLIENT_GEAR_ITEM_KEYS, CLIENT_GEAR_VARIANT_KEYS, toClientRecommendationRecord, toClientSavedOutfit } from "./clientGear";
import { toPublicGearItem } from "./publicGear";

// Fixtures carry the internal `version` counter AND an unexpected `internalNote` column at every level, and are deep-frozen: any in-place
// mutation by the serializer would throw (ES modules are strict), so passing also proves the inputs are never modified.
function deepFreeze<T>(value: T): T {
    if (value && typeof value === "object" && !(value instanceof Date)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
}
const date = new Date("2026-01-01T00:00:00.000Z");
const gear = (id: string, extra: Record<string, unknown> = {}) => ({
    id, name: `Gear ${id}`, brandId: "b1", genderTarget: null, category: "TOP", subcategory: null, priceRange: "MID", tags: ["a", "b"], bodyTypeFit: [],
    weatherHot: 0.4, weatherCold: null, weatherRain: 0.1, weatherWind: 0.2, imageUrl: null, affiliateUrl: "https://shop.example.com/x",
    createdAt: date, updatedAt: date, version: 7, internalNote: "item-secret",
    brand: { id: "b1", name: "Acme", normalizedName: "acme", tier: null, style: "road", createdAt: date, updatedAt: date, version: 3, internalNote: "brand-secret" },
    variants: [
        { id: `${id}-v2`, gearItemId: id, label: "B", gender: "women", affiliateUrl: "javascript:alert(1)", imageUrl: null, price: null, sizes: ["S"], createdAt: date, updatedAt: date, version: 9, internalNote: "variant-secret" },
        { id: `${id}-v1`, gearItemId: id, label: "A", gender: "men", affiliateUrl: "https://shop.example.com/v", imageUrl: "https://shop.example.com/i.png", price: 20, sizes: [], createdAt: date, updatedAt: date },
    ],
    ...extra,
});
const hasKey = (value: unknown, key: string): boolean => Array.isArray(value) ? value.some((entry) => hasKey(entry, key)) : value instanceof Date ? false : typeof value === "object" && value !== null ? Object.entries(value).some(([name, entry]) => name === key || hasKey(entry, key)) : false;

const outfit = () => deepFreeze({
    id: "o1", userId: "u1", recommendationId: "r1", name: "Kit", description: null, type: "favorites", isFavorite: true, createdAt: date, updatedAt: date,
    recommendation: { id: "r1", engineVersion: "1.2.3", output: { version: "keep-me" } },
    OutfitItem: [
        { id: "oi2", outfitId: "o1", gearItemId: "g2", category: "BOTTOM", gearItem: gear("g2", { category: "BOTTOM" }) },
        { id: "oi1", outfitId: "o1", gearItemId: "g1", category: "TOP", gearItem: gear("g1") },
    ],
});

test("saved outfit: gear `version` and unlisted columns are dropped at the item, brand and variant level; nothing else about the outfit changes", () => {
    const input = outfit();
    const snapshot = JSON.stringify(input);
    const result = toClientSavedOutfit(input);
    assert.equal(hasKey(result.OutfitItem, "version"), false, "no gear version at any depth of the nested gear objects");
    assert.equal(JSON.stringify(result).includes("secret"), false, "and no unlisted column");
    assert.equal(JSON.stringify(input), snapshot, "the input record is untouched");
    // Envelope: every other key and value of the outfit, including unrelated `version`-named data, is preserved.
    assert.deepEqual({ ...result, OutfitItem: undefined }, { ...input, OutfitItem: undefined });
    assert.deepEqual((result.recommendation as { output: unknown }).output, { version: "keep-me" }, "a `version` key that is not on a gear object is not this serializer's business");
    assert.equal((result.recommendation as { engineVersion: string }).engineVersion, "1.2.3");
});

test("saved outfit: array order, entry fields, nested brand and variants keep their values and order; links are contained", () => {
    const result = toClientSavedOutfit(outfit()) as unknown as { OutfitItem: Array<Record<string, unknown> & { gearItem: Record<string, unknown> & { brand: Record<string, unknown>; variants: Array<Record<string, unknown>> } }> };
    assert.deepEqual(result.OutfitItem.map((entry) => entry.id), ["oi2", "oi1"], "OutfitItem order is preserved");
    assert.deepEqual(result.OutfitItem.map((entry) => entry.category), ["BOTTOM", "TOP"]);
    const first = result.OutfitItem[0].gearItem;
    assert.deepEqual(Object.keys(first).sort(), ["affiliateUrl", "bodyTypeFit", "brand", "brandId", "category", "createdAt", "genderTarget", "id", "imageUrl", "name", "priceRange", "subcategory", "tags", "updatedAt", "variants", "weatherCold", "weatherHot", "weatherRain", "weatherWind"]);
    assert.deepEqual(first.brand, { id: "b1", name: "Acme", normalizedName: "acme", tier: null, style: "road", createdAt: date, updatedAt: date }, "nullable brand fields keep their null");
    assert.deepEqual(first.variants.map((variant) => variant.id), ["g2-v2", "g2-v1"], "variant order is preserved");
    assert.equal(first.variants[0].affiliateUrl, null, "an unsafe variant link is contained");
    assert.equal(first.variants[1].affiliateUrl, "https://shop.example.com/v", "a safe one is untouched");
    assert.equal(first.weatherCold, null, "nulls stay null");
    assert.deepEqual(first.tags, ["a", "b"]);
});

test("saved outfit: a null or missing gearItem, a missing OutfitItem and junk entries keep their shape", () => {
    assert.deepEqual(toClientSavedOutfit({ id: "o1" }), { id: "o1" }, "no OutfitItem key stays absent");
    assert.deepEqual(toClientSavedOutfit({ id: "o1", OutfitItem: [] }), { id: "o1", OutfitItem: [] });
    assert.deepEqual(toClientSavedOutfit({ id: "o1", OutfitItem: null }), { id: "o1", OutfitItem: null });
    const result = toClientSavedOutfit({ id: "o1", OutfitItem: [{ id: "a", gearItem: null }, { id: "b" }, null, "x", { id: "c", gearItem: gear("g9") }] }) as unknown as { OutfitItem: unknown[] };
    assert.deepEqual(result.OutfitItem.slice(0, 4), [{ id: "a", gearItem: null }, { id: "b" }, null, "x"]);
    assert.equal(hasKey(result, "version"), false);
});

test("recommendation history: the nested gearItem (item and brand, no variants) is rebuilt, the record and its items keep every other field and their order", () => {
    const record = deepFreeze({
        id: "r1", userId: "u1", engineVersion: "9.9.9", generatedAt: date, weatherSnapshot: { id: "w1", condition: "sun" },
        items: [
            { id: "i2", rank: 1, totalScore: 0.9, breakdown: { a: 1 }, gearItemId: "g2", gearItem: { ...gear("g2"), variants: undefined }, feedback: [{ feedbackType: "LIKE" }] },
            { id: "i1", rank: 2, totalScore: 0.5, breakdown: null, gearItemId: "g1", gearItem: { ...gear("g1"), variants: undefined }, feedback: [] },
        ],
    });
    const snapshot = JSON.stringify(record);
    const result = toClientRecommendationRecord(record) as unknown as { engineVersion: string; items: Array<Record<string, unknown> & { gearItem: Record<string, unknown> }> };
    assert.equal(JSON.stringify(record), snapshot, "input untouched");
    assert.equal(hasKey(result.items, "version"), false);
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.equal(result.engineVersion, "9.9.9", "the record's own engine version is a different thing and is preserved");
    assert.deepEqual(result.items.map((entry) => entry.id), ["i2", "i1"]);
    assert.deepEqual(result.items.map((entry) => [entry.rank, entry.totalScore, entry.breakdown, entry.feedback]), [[1, 0.9, { a: 1 }, [{ feedbackType: "LIKE" }]], [2, 0.5, null, []]]);
    assert.equal("variants" in result.items[0].gearItem, false, "a gear object that had no variants gets none");
    assert.deepEqual((result.items[0].gearItem.brand as Record<string, unknown>).name, "Acme");
});

test("the serializer returns new objects along the path and never aliases the input's gear objects", () => {
    const input = outfit();
    const result = toClientSavedOutfit(input) as unknown as { OutfitItem: Array<{ gearItem: object }> };
    assert.notEqual(result, input);
    assert.notEqual(result.OutfitItem, input.OutfitItem);
    assert.notEqual(result.OutfitItem[0].gearItem, input.OutfitItem[0].gearItem);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Compile-time contract. These functions are never called: they exist so `tsc` checks the types the real services expose. If `version`
// (or anything else off the allow-list) ever became readable again, an `@ts-expect-error` below would turn into an "unused directive"
// error and the type check would fail.
// ---------------------------------------------------------------------------------------------------------------------------------
type ServiceOutfit = NonNullable<Awaited<ReturnType<typeof getSavedOutfitById>>>;
type ServiceOutfitList = Awaited<ReturnType<typeof listSavedOutfitsByUserId>>;
type ServiceHistory = Awaited<ReturnType<typeof getRecommendationHistory>>;

function savedOutfitTypeContract(outfit: ServiceOutfit, list: ServiceOutfitList) {
    const entry = outfit.OutfitItem[0];                                     // OutfitItem is a required array, not `unknown`
    const entryId: string = entry.id;                                       // fields of the entry that are preserved keep their exact types
    const gearItemId: string = entry.gearItemId;
    const outfitName: string | null = outfit.name;                          // and so do the outfit's own fields
    const name: string | undefined = entry.gearItem.name;                   // allow-listed gear fields are readable
    const priceRange: string | undefined = entry.gearItem.priceRange;
    const brandName: string | undefined = entry.gearItem.brand?.name;
    const variantLabel: string | undefined = entry.gearItem.variants?.[0].label;
    const fromList: string | undefined = list[0].OutfitItem[0].gearItem.name;
    // @ts-expect-error the gear version counter is not part of the client-facing contract
    const version = entry.gearItem.version;
    // @ts-expect-error nor is a relation that was never part of the response
    const nested = entry.gearItem.OutfitItem;
    // @ts-expect-error `gearItem` is the rebuilt object, so the repository's raw row type no longer applies to it
    const raw: { version: number } = entry.gearItem;
    return [entryId, gearItemId, outfitName, name, priceRange, brandName, variantLabel, fromList, version, nested, raw];
}

function historyTypeContract(records: ServiceHistory) {
    const item = records[0].items[0];
    const rank: number = item.rank;
    const score: number = item.totalScore;
    const engine: string = records[0].engineVersion;                        // the record's own engine version is untouched
    const name: string | undefined = item.gearItem.name;
    const brandName: string | undefined = item.gearItem.brand?.name;
    // @ts-expect-error the gear version counter is not part of the client-facing contract
    const version = item.gearItem.version;
    return [rank, score, engine, name, brandName, version];
}

test("the compile-time type contract is checked by tsc (these functions are intentionally never called)", () => {
    assert.equal(typeof savedOutfitTypeContract, "function");
    assert.equal(typeof historyTypeContract, "function");
});

test("the key lists behind the types match the runtime allow-list exactly (no drift between the type and the serializer)", () => {
    const sample = toPublicGearItem(gear("g1")) as Record<string, unknown> & { brand: Record<string, unknown>; variants: Array<Record<string, unknown>> };
    assert.deepEqual(Object.keys(sample).filter((key) => key !== "brand" && key !== "variants").sort(), [...CLIENT_GEAR_ITEM_KEYS].sort());
    assert.deepEqual(Object.keys(sample.brand).sort(), [...CLIENT_GEAR_BRAND_KEYS].sort());
    assert.deepEqual(Object.keys(sample.variants[1]).sort(), [...CLIENT_GEAR_VARIANT_KEYS].sort());
});

test("affiliate links in saved outfit and history gear objects: unsafe becomes null, safe is unchanged, absent shapes are preserved", () => {
    const rows = {
        safe: gear("safe", { affiliateUrl: "https://shop.example.com/ok", variants: [{ id: "a", affiliateUrl: "HTTPS://shop.example.com/Upper" }, { id: "b", affiliateUrl: "" }, { id: "c", affiliateUrl: null }, { id: "d" }] }),
        unsafe: gear("unsafe", { affiliateUrl: "javascript:alert(1)", variants: [{ id: "a", affiliateUrl: "data:text/html,x" }, { id: "b", affiliateUrl: "https://user:pw@shop.example.com/x" }] }),
        blank: gear("blank", { affiliateUrl: "" }),
        none: gear("none", { affiliateUrl: null }),
    };
    const outfit = toClientSavedOutfit({ id: "o", OutfitItem: Object.values(rows).map((gearItem, index) => ({ id: `e${index}`, gearItem })) });
    const history = toClientRecommendationRecord({ id: "r", items: Object.values(rows).map((gearItem, index) => ({ id: `i${index}`, gearItem })) });
    for (const result of [outfit.OutfitItem, history.items]) {
        const [safe, unsafe, blank, none] = result.map((entry) => entry.gearItem) as Array<{ affiliateUrl?: unknown; variants: Array<{ affiliateUrl?: unknown }> }>;
        assert.equal(safe.affiliateUrl, "https://shop.example.com/ok", "a safe item link is unchanged");
        assert.deepEqual(safe.variants.map((variant) => variant.affiliateUrl), ["HTTPS://shop.example.com/Upper", "", null, undefined], "safe, blank, null and absent variant links keep their exact shape");
        assert.equal(unsafe.affiliateUrl, null, "an unsafe item link serializes as null");
        assert.deepEqual(unsafe.variants.map((variant) => variant.affiliateUrl), [null, null], "unsafe variant links serialize as null");
        assert.equal(blank.affiliateUrl, "", "a blank link stays blank (the same rule as the public catalog)");
        assert.equal(none.affiliateUrl, null);
    }
});
