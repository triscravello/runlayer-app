import assert from "node:assert/strict";
import test from "node:test";
import { containAffiliateUrl, containGearItemLinks, containVariantLink, selectProductVariant } from "./productVariant";

const SAFE = "https://example.com/buy";
const UNSAFE = ["javascript:alert(1)", "data:text/html,x", "ftp://example.com/x", "//evil.example/x", "https://user:pw@example.com/x", "not a url"];
const item = (over: Record<string, unknown>) => ({ affiliateUrl: null, genderTarget: null, imageUrl: null, variants: [], ...over }) as Parameters<typeof selectProductVariant>[0];

test("containAffiliateUrl keeps safe links and every flavor of 'no link' exactly as stored", () => {
    assert.equal(containAffiliateUrl(SAFE), SAFE);
    assert.equal(containAffiliateUrl(null), null);
    assert.equal(containAffiliateUrl(undefined), undefined);
    assert.equal(containAffiliateUrl(""), "");
    for (const value of UNSAFE) assert.equal(containAffiliateUrl(value), null, value);
});

test("a stored variant with an unsafe link is selected with no link", () => {
    for (const value of UNSAFE) {
        const selected = selectProductVariant(item({ variants: [{ label: "Default", gender: "unisex", affiliateUrl: value, imageUrl: "https://example.com/i.png" }] }));
        assert.equal(selected?.label, "Default");
        assert.equal(selected?.affiliateUrl, null, value);
        assert.equal(selected?.imageUrl, "https://example.com/i.png", "imageUrl is not touched");
    }
});

test("an uppercase-scheme link is a valid link and keeps its button", () => {
    const selected = selectProductVariant(item({ variants: [{ label: "Default", gender: "unisex", affiliateUrl: "HTTPS://example.com/buy" }] }));
    assert.equal(selected?.affiliateUrl, "HTTPS://example.com/buy");
    assert.equal(selectProductVariant(item({ affiliateUrl: "HTTP://example.com/buy" }))?.affiliateUrl, "HTTP://example.com/buy");
});

test("safe variants are returned as the very same object", () => {
    const variant = { label: "Default", gender: "unisex" as const, affiliateUrl: SAFE };
    assert.equal(selectProductVariant(item({ variants: [variant] })), variant);
});

test("selection is unchanged by containment: the preferred variant is still chosen, just without its link", () => {
    const variants = [
        { label: "Men", gender: "men" as const, affiliateUrl: "javascript:alert(1)" },
        { label: "Women", gender: "women" as const, affiliateUrl: SAFE },
        { label: "Unisex", gender: "unisex" as const, affiliateUrl: SAFE },
    ];
    assert.deepEqual(selectProductVariant(item({ variants }), { genderPreference: "men" }), { label: "Men", gender: "men", affiliateUrl: null });
    assert.equal(selectProductVariant(item({ variants }), { genderPreference: "women" })?.affiliateUrl, SAFE);
    assert.equal(selectProductVariant(item({ variants }))?.label, "Unisex");
});

test("mixed variants: only the unsafe ones lose their link", () => {
    const variants = [
        { label: "A", gender: "men" as const, affiliateUrl: "data:text/html,x" },
        { label: "B", gender: "women" as const, affiliateUrl: SAFE },
        { label: "C", gender: "unisex" as const, affiliateUrl: "" },
        { label: "D", gender: "unisex" as const, affiliateUrl: null },
        { label: "E", gender: "unisex" as const },
    ];
    assert.deepEqual(variants.map((variant) => containVariantLink(variant).affiliateUrl), [null, SAFE, "", null, undefined]);
    assert.equal("affiliateUrl" in containVariantLink(variants[4]), false, "an absent link stays absent");
});

test("the fallback variant built from the item's own link is contained too", () => {
    assert.equal(selectProductVariant(item({ affiliateUrl: SAFE }))?.affiliateUrl, SAFE);
    for (const value of UNSAFE) {
        const selected = selectProductVariant(item({ affiliateUrl: value }));
        assert.equal(selected?.label, "Default", "a fallback still exists, as before");
        assert.equal(selected?.affiliateUrl, "", value);
    }
    assert.equal(selectProductVariant(item({})), null, "no link and no image: still no fallback");
});

test("legacy blank links keep their existing shape", () => {
    assert.equal(selectProductVariant(item({ variants: [{ label: "Default", gender: "unisex", affiliateUrl: "" }] }))?.affiliateUrl, "");
    assert.equal(selectProductVariant(item({ variants: [{ label: "Default", gender: "unisex", affiliateUrl: null }] }))?.affiliateUrl, null);
});

test("containment never mutates its input", () => {
    const row = { id: "g1", affiliateUrl: "javascript:alert(1)", variants: [{ label: "A", gender: "men", affiliateUrl: "data:x" }] };
    const snapshot = JSON.parse(JSON.stringify(row));
    const contained = containGearItemLinks(row);
    assert.deepEqual(row, snapshot);
    assert.equal(contained.affiliateUrl, null);
    assert.equal(contained.variants[0].affiliateUrl, null);
});

test("containGearItemLinks leaves other fields and absent keys alone", () => {
    const row: { id: string; name: string; imageUrl: string; tags: string[]; affiliateUrl?: string | null } = { id: "g1", name: "Tee", imageUrl: "javascript:alert(1)", tags: ["a"] };
    const contained = containGearItemLinks(row);
    assert.deepEqual(contained, row);
    assert.equal("affiliateUrl" in contained, false);
    assert.equal("variants" in contained, false);
    assert.equal(contained.imageUrl, "javascript:alert(1)", "imageUrl handling is out of scope");
});
