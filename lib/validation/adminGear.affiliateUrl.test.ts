import assert from "node:assert/strict";
import test from "node:test";
import { isSafeHttpUrl, MAX_EXTERNAL_URL_LENGTH } from "@/lib/gear/externalUrl";
import { validateGearItem } from "@/lib/ingestion/validators/gearValidator";
import { createGearItemSchema, updateGearItemSchema } from "./adminGear";

// Write-side policy for affiliate links, checked at every validation layer against the ONE shared policy (lib/gear/externalUrl.ts).
// The repository layer has its own file (lib/db/gearRepository.affiliateWrite.test.ts). Pure: no database.

const GOOD = [
    "https://shop.example.com/p?id=1#x", "http://shop.example.com", "HTTPS://shop.example.com/Path", "HTTP://shop.example.com/Path?Q=1",
    "Https://Shop.Example.COM/x", "hTtP://shop.example.com", `https://shop.example.com/${"a".repeat(MAX_EXTERNAL_URL_LENGTH - 25)}`,
];
const BAD = [
    "javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://shop.example.com/x", "vbscript:x",
    "//shop.example.com/x", "/relative/path", "shop.example.com", "not a url", "https://", "http://", "https:example.com", "httpss://x.example",
    "https://user:pass@shop.example.com/x", "https://trusted.example@evil.example/x", "HTTPS://user@shop.example.com", "https://shop.example.com/a b",
    "https://shop.example.com/\tx", "https://shop.example.com/\nx", "https://shop.example.com/\u0000x",
    " https://shop.example.com/x", "https://shop.example.com/x ", "  https://shop.example.com/x  ", "\thttps://shop.example.com/x\n", "\u0000", "\u0000 ", `https://shop.example.com/${"a".repeat(MAX_EXTERNAL_URL_LENGTH)}`,
];
const BLANK = ["", " ", "   ", "\t", "\n", " \r\n\t "];

const BASE = { name: "Trail Tee", brandId: "b1", category: "TOP", priceRange: "MID" } as const;
const variant = (affiliateUrl: unknown) => ({ label: "A", gender: "men", affiliateUrl });

test("the shared policy classifies the fixtures as expected (guards the fixtures themselves)", () => {
    for (const value of GOOD) assert.equal(isSafeHttpUrl(value), true, value.slice(0, 40));
    for (const value of BAD) assert.equal(isSafeHttpUrl(value), false, value.slice(0, 40));
});

test("every validation layer accepts exactly what the shared policy accepts, for variant links", () => {
    for (const value of [...GOOD, ...BAD]) {
        const expected = isSafeHttpUrl(value);
        assert.equal(createGearItemSchema.safeParse({ ...BASE, variants: [variant(value)] }).success, expected, `create: ${value.slice(0, 40)}`);
        assert.equal(updateGearItemSchema.safeParse({ variants: [variant(value)] }).success, expected, `update: ${value.slice(0, 40)}`);
        assert.equal(validateGearItem({ name: "x", brand: "nike", category: "top", price: 10, variants: [variant(value)] }).length === 0, expected, `cli variant: ${value.slice(0, 40)}`);
        assert.equal(validateGearItem({ name: "x", brand: "nike", category: "top", price: 10, affiliateUrl: value }).length === 0, expected, `cli item: ${value.slice(0, 40)}`);
    }
});

test("an accepted link is stored exactly as submitted; a padded nonblank link is rejected, never trimmed into validity", () => {
    for (const value of GOOD) {
        const parsed = createGearItemSchema.parse({ ...BASE, variants: [variant(value)] });
        assert.equal(parsed.variants?.[0].affiliateUrl, value);
    }
    for (const padded of [" https://shop.example.com/x", "https://shop.example.com/x ", "\thttps://shop.example.com/x\n"]) {
        assert.equal(createGearItemSchema.safeParse({ ...BASE, variants: [variant(padded)] }).success, false);
        assert.equal(updateGearItemSchema.safeParse({ variants: [variant(padded)] }).success, false);
        assert.equal(createGearItemSchema.safeParse({ ...BASE, affiliateUrl: padded }).success, false);
        assert.equal(validateGearItem({ name: "x", brand: "nike", category: "top", price: 10, affiliateUrl: padded }).length, 1);
        assert.equal(validateGearItem({ name: "x", brand: "nike", category: "top", price: 10, variants: [variant(padded)] }).length, 1);
    }
});

test("blank variant links become null; null and omitted are null on a replacement variant", () => {
    for (const value of [...BLANK, null, undefined]) {
        assert.equal(createGearItemSchema.parse({ ...BASE, variants: [variant(value)] }).variants?.[0].affiliateUrl, null, JSON.stringify(value));
        assert.equal(updateGearItemSchema.parse({ variants: [variant(value)] }).variants?.[0].affiliateUrl, null, JSON.stringify(value));
    }
    assert.equal(createGearItemSchema.parse({ ...BASE, variants: [{ label: "A", gender: "men" }] }).variants?.[0].affiliateUrl, null);
});

test("rejections are validation errors that never echo the submitted value", () => {
    for (const value of ["javascript:alert('SECRET-TOKEN')", "https://user:SECRET-TOKEN@shop.example.com/"]) {
        const result = createGearItemSchema.safeParse({ ...BASE, variants: [variant(value)] });
        assert.equal(result.success, false);
        assert.ok(!JSON.stringify(result.error?.issues).includes("SECRET-TOKEN"));
    }
});

test("create: the item-level link follows the same policy (it becomes the Default variant's link); blank is still not a URL there", () => {
    for (const value of [...GOOD, ...BAD]) assert.equal(createGearItemSchema.safeParse({ ...BASE, affiliateUrl: value }).success, isSafeHttpUrl(value), value.slice(0, 40));
    assert.equal(createGearItemSchema.parse({ ...BASE, affiliateUrl: null }).affiliateUrl, null);
    assert.equal(createGearItemSchema.parse({ ...BASE }).affiliateUrl, null);
    assert.equal(createGearItemSchema.safeParse({ ...BASE, affiliateUrl: "" }).success, false, "unchanged: an empty item-level string was never accepted");
});

test("update: the item-level link validation is unchanged, so a legacy record stays editable; an omitted link stays omitted", () => {
    assert.equal(updateGearItemSchema.parse({ name: "x" }).affiliateUrl, undefined);
    assert.equal(updateGearItemSchema.parse({ affiliateUrl: null }).affiliateUrl, null);
    assert.equal(updateGearItemSchema.parse({ affiliateUrl: "https://shop.example.com/x" }).affiliateUrl, "https://shop.example.com/x");
    assert.equal(updateGearItemSchema.safeParse({ affiliateUrl: "javascript:alert(1)" }).success, false, "unchanged");
    assert.equal(updateGearItemSchema.parse({ name: "x" }).variants, undefined, "omitted variants stay omitted, so stored variants are never re-validated");
});

test("CLI validator: blank links are fine, messages never echo the value, and per-row errors do not abort", () => {
    const row = { name: "x", brand: "nike", category: "top", price: 10 };
    for (const value of [...BLANK, null, undefined]) assert.deepEqual(validateGearItem({ ...row, affiliateUrl: value, variants: [variant(value)] }), [], JSON.stringify(value));
    const errors = validateGearItem({ ...row, affiliateUrl: "javascript:SECRET-TOKEN", variants: [variant("https://ok.example.com/"), variant("ftp://SECRET-TOKEN")] });
    assert.deepEqual(errors, ["affiliateUrl must be an http(s) link", "variants[1].affiliateUrl must be an http(s) link"]);
    assert.ok(!errors.join().includes("SECRET-TOKEN"));
    assert.deepEqual(validateGearItem({ ...row, variants: "not-an-array" }), [], "unchanged: a non-array `variants` was always ignored by the CLI mapper");
});

test("admin bulk import validates the row link with the same policy, per row, and uppercase schemes pass", async () => {
    const { validateBulkGearImportRows } = await import("./adminGearImport");
    const nike = { id: "11111111-1111-4111-8111-111111111111", name: "Nike", tier: null, style: null, createdAt: new Date(0), updatedAt: new Date(0) };
    const row = (name: string, affiliateUrl: unknown) => ({ name, brand: "Nike", category: "TOP", priceRange: "MID", affiliateUrl });
    const result = validateBulkGearImportRows([row("A", "HTTPS://shop.example.com/a"), row("B", "javascript:alert(1)"), row("C", "https://u:p@shop.example.com/"), row("D", ""), row("E", undefined), row("F", "  https://shop.example.com/f  "), row("G", "   ")], [nike]);
    assert.deepEqual(result.rows.map((entry) => entry.status), ["valid", "invalid", "invalid", "valid", "valid", "invalid", "valid"]);
    assert.deepEqual(result.validItems.map((item) => item.affiliateUrl), ["HTTPS://shop.example.com/a", null, null, null]);
});
