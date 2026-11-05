import assert from "node:assert/strict";
import test from "node:test";
import type { BrandRow } from "@/lib/db/brandRepository";
import { validateBulkGearImportRows } from "./adminGearImport";

const brand = (id: string, name: string): BrandRow => ({ id, name, tier: null, style: null, createdAt: new Date(0), updatedAt: new Date(0) });
const NIKE = brand("11111111-1111-4111-8111-111111111111", "Nike");
const BROOKS = brand("22222222-2222-4222-8222-222222222222", "Brooks");

const row = (overrides: Record<string, unknown> = {}) => ({ name: "Run Top", brand: "Nike", category: "TOP", priceRange: "MID", ...overrides });

test("admin import resolves an existing brand by name, case- and whitespace-insensitively", () => {
    const result = validateBulkGearImportRows([row({ brand: "  nIKe " }), row({ name: "B", brand: "Brooks" })], [NIKE, BROOKS]);

    assert.equal(result.validRows, 2);
    assert.deepEqual(result.validItems.map((item) => item.brandId), [NIKE.id, BROOKS.id]);
});

test("admin import resolves an existing brand by id", () => {
    const result = validateBulkGearImportRows([row({ brand: undefined, brandId: NIKE.id })], [NIKE]);
    assert.equal(result.validRows, 1);
    assert.equal(result.validItems[0].brandId, NIKE.id);
});

test("admin import still requires an existing brand: an unknown name is rejected, never created", () => {
    const result = validateBulkGearImportRows([row({ brand: "Adidas" })], [NIKE]);

    assert.equal(result.validRows, 0);
    assert.equal(result.rows[0].status, "invalid");
    assert.match(result.rows[0].errors.join("|"), /brand does not exist/);
});

test("admin import rejects an unknown brandId and a missing brand", () => {
    const unknownId = validateBulkGearImportRows([row({ brand: undefined, brandId: "nike" })], [NIKE]);
    assert.match(unknownId.rows[0].errors.join("|"), /unknown brandId/);

    const missing = validateBulkGearImportRows([row({ brand: undefined })], [NIKE]);
    assert.match(missing.rows[0].errors.join("|"), /brandId or brand is required/);
});

test("admin import rejects a brandId whose name disagrees with the supplied brand", () => {
    const result = validateBulkGearImportRows([row({ brand: "Brooks", brandId: NIKE.id })], [NIKE, BROOKS]);
    assert.equal(result.validRows, 0);
    assert.match(result.rows[0].errors.join("|"), /conflicts with brandId/);
});

test("admin import rejects a name shared by several existing brands as ambiguous", () => {
    const twin = brand("33333333-3333-4333-8333-333333333333", "NIKE");
    const result = validateBulkGearImportRows([row({ brand: "nike" })], [NIKE, twin]);

    assert.equal(result.validRows, 0);
    assert.match(result.rows[0].errors.join("|"), /ambiguous brand/);

    const byId = validateBulkGearImportRows([row({ brand: undefined, brandId: twin.id })], [NIKE, twin]);
    assert.equal(byId.validRows, 1, "an explicit id is unambiguous");
});

test("admin import reports an invalid brand value without crashing the batch", () => {
    const result = validateBulkGearImportRows([row({ brand: "x".repeat(500) }), row({ name: "Ok" })], [NIKE]);
    assert.equal(result.validRows, 1);
    assert.match(result.rows[0].errors.join("|"), /invalid brand value/);
});
