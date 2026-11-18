import assert from "node:assert/strict";
import test from "node:test";
import { toPublicGearItem } from "./publicGear";

test("only allow-listed fields survive, at the item, brand and variant level", () => {
    const result = toPublicGearItem({
        id: "g1", name: "Tee", version: 4, extra: "x", affiliateUrl: "https://shop.example.com/a",
        brand: { id: "b1", name: "Acme", version: 2, secret: "s" },
        variants: [{ id: "v1", label: "A", gender: "men", version: 1, secret: "s" }],
    });
    assert.deepEqual(result, { id: "g1", name: "Tee", affiliateUrl: "https://shop.example.com/a", brand: { id: "b1", name: "Acme" }, variants: [{ id: "v1", label: "A", gender: "men" }] });
});

test("a spread or inherited `version` can not get through: own, inherited and symbol keys are not copied", () => {
    const proto = { version: 99 };
    const item = Object.assign(Object.create(proto) as object, { id: "g1", name: "Tee" });
    Object.defineProperty(item, "version", { value: 5, enumerable: false });
    (item as Record<symbol, unknown>)[Symbol("version")] = 1;
    assert.deepEqual(toPublicGearItem({ ...item, version: 6 }), { id: "g1", name: "Tee" });
    assert.deepEqual(toPublicGearItem(item), { id: "g1", name: "Tee" });
    assert.equal(JSON.stringify(toPublicGearItem({ id: "g", brand: { id: "b", version: 1 }, variants: [{ id: "v", version: 1 }] })).includes("version"), false);
});

test("unsafe affiliate links are still contained before shaping, and the input is not mutated", () => {
    const input = { id: "g1", affiliateUrl: "javascript:alert(1)", variants: [{ id: "v1", affiliateUrl: "data:text/html,x" }, { id: "v2", affiliateUrl: "https://shop.example.com/ok" }] };
    const snapshot = JSON.stringify(input);
    const result = toPublicGearItem(input) as { affiliateUrl: unknown; variants: Array<{ affiliateUrl: unknown }> };
    assert.equal(result.affiliateUrl, null);
    assert.deepEqual(result.variants.map((variant) => variant.affiliateUrl), [null, "https://shop.example.com/ok"]);
    assert.equal(JSON.stringify(input), snapshot);
});

test("absent and null values keep their shape: undefined is omitted, null is kept, a null brand stays null, a missing brand stays missing", () => {
    assert.deepEqual(toPublicGearItem({ id: "g1", subcategory: null, imageUrl: undefined, brand: null }), { id: "g1", subcategory: null, brand: null });
    assert.deepEqual(toPublicGearItem({ id: "g1" }), { id: "g1" });
    assert.deepEqual(toPublicGearItem({ id: "g1", variants: [] }), { id: "g1", variants: [] });
});

test("malformed nested values are dropped rather than passed through", () => {
    const result = toPublicGearItem({ id: "g1", brand: "not-an-object", variants: [null, "x", { id: "v1", version: 3 }] });
    assert.deepEqual(result, { id: "g1", variants: [{ id: "v1" }] });
});

test("null and non-object variant entries are dropped safely, valid entries keep their order, and nothing throws", () => {
    const junk: unknown[] = [null, undefined, "x", 7, true, [], [{ id: "nested" }], () => "fn"];
    const valid = [{ id: "v1", label: "A", version: 1 }, { id: "v2", label: "B" }, { id: "v3", label: "C", affiliateUrl: "javascript:alert(1)" }];
    // Junk interleaved before, between and after the valid entries.
    const variants = [junk[0], valid[0], junk[1], junk[2], valid[1], junk[3], junk[4], valid[2], ...junk.slice(5)];
    const result = toPublicGearItem({ id: "g1", variants }) as { variants: Array<Record<string, unknown>> };
    assert.deepEqual(result.variants.map((variant) => variant.id), ["v1", "v2", "v3"], "only the objects remain, in their original order");
    assert.equal(result.variants[0].label, "A");
    assert.equal("version" in result.variants[0], false, "and they are still allow-listed");
    assert.equal(result.variants[2].affiliateUrl, null, "and still link-contained");
    assert.deepEqual(toPublicGearItem({ id: "g1", variants: [null, undefined, "x"] }), { id: "g1", variants: [] }, "all-junk becomes an empty list, not a crash");
    assert.deepEqual(toPublicGearItem({ id: "g1", variants: "not-an-array" }), { id: "g1" }, "a non-array variants value is omitted");
});

test("valid arrays are returned in the same order they came in, item for item", () => {
    const variants = ["d", "b", "c", "a"].map((label, index) => ({ id: `v${index}`, label }));
    const result = toPublicGearItem({ id: "g1", tags: ["z", "a"], variants }) as { tags: string[]; variants: Array<{ label: string }> };
    assert.deepEqual(result.variants.map((variant) => variant.label), ["d", "b", "c", "a"]);
    assert.deepEqual(result.tags, ["z", "a"], "scalar arrays are passed through untouched");
});
