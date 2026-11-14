import assert from "node:assert/strict";
import test from "node:test";
import type { GearWriteInput } from "@/services/gearService";
import type { ResolvedBrandOutcome } from "./brandResolution";
import { importGear, type ImportGearDeps } from "./importGear";

// CLI gear ingestion and affiliate links: unsafe rows fail individually, before any brand or database work for them; valid and
// blank links import exactly as before. Pure: parsing, brand resolution and persistence are all injected fakes.
const row = (overrides: Record<string, unknown> = {}) => ({ name: "Run Top", brand: "nike", category: "top", price: 100, ...overrides });

function createDeps(rows: unknown[]) {
    const written: GearWriteInput[][] = [];
    const resolvedFor: string[] = [];
    const deps: ImportGearDeps = {
        parseItems: async () => rows,
        resolveBrands: async (references) => references.map((reference) => { resolvedFor.push(String(reference.name)); return { status: "resolved", brandId: "11111111-1111-4111-8111-111111111111" } as unknown as ResolvedBrandOutcome; }),
        bulkUpsert: async (batch) => { written.push(batch); return { inserted: batch.length, updated: 0, failed: [] }; },
    };
    return { deps, written, resolvedFor };
}

test("rows with an unsafe item or variant link fail individually, are never written, and do not abort the valid rows", async () => {
    const { deps, written } = createDeps([
        row({ name: "Bad Item Link", affiliateUrl: "javascript:alert(1)" }),
        row({ name: "Good", affiliateUrl: "https://shop.example.com/good" }),
        row({ name: "Bad Variant Link", variants: [{ label: "A", gender: "men", affiliateUrl: "data:text/html,x" }] }),
        row({ name: "Credentials", affiliateUrl: "https://user:pass@shop.example.com/x" }),
        row({ name: "Protocol Relative", affiliateUrl: "//shop.example.com/x" }),
        row({ name: "Padded", affiliateUrl: "  https://shop.example.com/p  " }),
        row({ name: "Padded Variant", variants: [{ label: "A", gender: "men", affiliateUrl: " https://shop.example.com/v" }] }),
    ]);
    const result = await importGear(deps);

    assert.equal(result.processed, 7);
    assert.equal(result.inserted, 1);
    assert.deepEqual(result.failed.map((entry) => [entry.name, entry.reason]), [
        ["Bad Item Link", "affiliateUrl must be an http(s) link"],
        ["Bad Variant Link", "variants[0].affiliateUrl must be an http(s) link"],
        ["Credentials", "affiliateUrl must be an http(s) link"],
        ["Protocol Relative", "affiliateUrl must be an http(s) link"],
        ["Padded", "affiliateUrl must be an http(s) link"],
        ["Padded Variant", "variants[0].affiliateUrl must be an http(s) link"],
    ]);
    assert.deepEqual(written[0].map((item) => item.name), ["Good"]);
    assert.ok(!JSON.stringify(result.failed).includes("alert(1)"), "failure reasons never echo the link");
});

test("valid import compatibility: valid, uppercase-scheme, blank, null and absent links import as before (padded nonblank links are rejected above)", async () => {
    const { deps, written, resolvedFor } = createDeps([
        row({ name: "Plain", affiliateUrl: "https://shop.example.com/a" }),
        row({ name: "Upper", affiliateUrl: "HTTPS://SHOP.EXAMPLE.COM/A" }),
        row({ name: "Blank", affiliateUrl: "   " }),
        row({ name: "Null", affiliateUrl: null }),
        row({ name: "Absent" }),
    ]);
    const result = await importGear(deps);

    assert.deepEqual(result.failed, []);
    assert.equal(result.inserted, 5);
    assert.deepEqual(written[0].map((item) => [item.name, item.affiliateUrl]), [
        ["Plain", "https://shop.example.com/a"], ["Upper", "HTTPS://SHOP.EXAMPLE.COM/A"],
        ["Blank", null], ["Null", null], ["Absent", null],
    ]);
    assert.equal(resolvedFor.length, 5);
});

test("an invalid-link row is rejected before brand resolution, so it can neither create a brand nor reach persistence", async () => {
    const { deps, written, resolvedFor } = createDeps([row({ name: "Bad", brand: "newbrand", affiliateUrl: "ftp://x.example/" })]);
    const result = await importGear(deps);
    assert.deepEqual(resolvedFor, []);
    assert.equal(written.length, 0);
    assert.equal(result.failed.length, 1);
});
