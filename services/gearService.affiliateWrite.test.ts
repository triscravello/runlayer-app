import assert from "node:assert/strict";
import test from "node:test";
import { InvalidGearInputError } from "@/lib/gear/inputErrors";
import { safeWriteFailureReason } from "@/lib/ingestion/writeRecovery";
import { createRecordingGearClient } from "../test-support/gearStoreFake";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never"; // defense in depth; the launcher already neutralizes the real one

// Affiliate-link write validation through the real service and repository, against a recording fake in place of Prisma. The stored
// item below is LEGACY data: it predates link validation and holds unsafe links at item level and in a variant.
type Call = { where?: { id: string }; data: Record<string, unknown> };
const updates: Call[] = [];
const creates: Call[] = [];
const LEGACY_ITEM_URL = "javascript:legacy-item";
const LEGACY_VARIANT_URL = "https://user:pass@legacy.example/variant";
const stored = {
    id: "g1", name: "Trail Tee", brandId: "b1", genderTarget: "men", category: "TOP", subcategory: "tee", priceRange: "MID",
    tags: ["keep"], bodyTypeFit: [], imageUrl: "https://e.test/i.png", affiliateUrl: LEGACY_ITEM_URL,
    createdAt: new Date(0), updatedAt: new Date(0), brand: { id: "b1" },
    variants: [{ id: "v1", gearItemId: "g1", createdAt: new Date(0), updatedAt: new Date(0), label: "A", gender: "men", affiliateUrl: LEGACY_VARIANT_URL, imageUrl: null, price: null, sizes: [] }],
};
const snapshot = JSON.stringify(stored);
(globalThis as unknown as { prisma: unknown }).prisma = {
    $transaction: createRecordingGearClient(updates as never, (id) => (id === stored.id ? (stored as never) : null)).$transaction,
    gearItem: {
        findMany: async () => [stored],
        findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, true> }) => (where.id === stored.id ? Object.fromEntries(Object.keys(select).map((key) => [key, (stored as Record<string, unknown>)[key]])) : null),
        create: async (args: Call) => { creates.push(args); return { id: "new" }; },
    },
};
const reset = () => { updates.length = 0; creates.length = 0; };
const variant = (affiliateUrl: string | null) => ({ label: "N", gender: "men", affiliateUrl });
const NEW_ITEM = { name: "Brand New", brandId: "b1", category: "TOP", priceRange: "MID", affiliateUrl: null } as const;

test("legacy: PATCH {name} succeeds, never touches the stored unsafe variant, and leaves stored links as they were", async () => {
    const { updateGearItem } = await import("./gearService");
    reset();
    await updateGearItem("g1", { name: "Renamed" });
    assert.equal(updates.length, 1);
    assert.equal("variants" in updates[0].data, false, "no variants operation: stored variants and their ids are untouched");
    assert.equal("affiliateUrl" in updates[0].data, false, "the unsafe stored item link is neither rewritten nor rejected: it is not part of the write");
    assert.equal(JSON.stringify(stored), snapshot, "the stored objects were not mutated");
});

test("legacy: explicit undefined variants behave like omitted variants", async () => {
    const { updateGearItem } = await import("./gearService");
    reset();
    await updateGearItem("g1", { name: "Renamed", variants: undefined });
    assert.equal("variants" in updates[0].data, false);
});

test("an explicitly submitted unsafe variant link is rejected with no write, even on a legacy item", async () => {
    const { updateGearItem } = await import("./gearService");
    for (const value of ["javascript:alert(1)", "data:text/html,x", "https://u:p@x.example/", "//x.example/", "https://x.example/a b"]) {
        reset();
        await assert.rejects(updateGearItem("g1", { variants: [variant(value)] }), InvalidGearInputError);
        assert.equal(updates.length, 0);
    }
});

test("an explicitly submitted valid variant replaces the legacy ones, and blank becomes null", async () => {
    const { updateGearItem } = await import("./gearService");
    reset();
    await updateGearItem("g1", { variants: [variant("HTTPS://Shop.Example.com/x"), variant("   "), variant(null)] });
    const create = (updates[0].data.variants as { deleteMany: object; create: Array<Record<string, unknown>> }).create;
    assert.deepEqual(create.map((entry) => entry.affiliateUrl), ["HTTPS://Shop.Example.com/x", null, null]);
});

test("variants: [] keeps its Default-variant behavior; an unsafe STORED item link is not copied into the new Default", async () => {
    const { updateGearItem } = await import("./gearService");
    reset();
    await updateGearItem("g1", { variants: [] });
    const create = (updates[0].data.variants as { create: Array<Record<string, unknown>> }).create;
    assert.equal(create.length, 1);
    assert.equal(create[0].label, "Default");
    assert.equal(create[0].gender, "unisex");
    assert.equal(create[0].affiliateUrl, null, "legacy unsafe link dropped from the NEW row only");
    assert.equal(create[0].imageUrl, "https://e.test/i.png");
    assert.equal("affiliateUrl" in updates[0].data, false, "the item-level stored value itself is not rewritten");
});

test("variants: [] copies a safe stored item link, and a link supplied in the same request is validated, not dropped", async () => {
    const { updateGearItem } = await import("./gearService");
    const original = stored.affiliateUrl;
    try {
        stored.affiliateUrl = "https://shop.example.com/safe";
        reset();
        await updateGearItem("g1", { variants: [] });
        assert.equal((updates[0].data.variants as { create: Array<Record<string, unknown>> }).create[0].affiliateUrl, "https://shop.example.com/safe");
    } finally {
        stored.affiliateUrl = original;
    }
    reset();
    await assert.rejects(updateGearItem("g1", { variants: [], affiliateUrl: "https://user:pass@x.example/" }), InvalidGearInputError);
    assert.equal(updates.length, 0);
    reset();
    await updateGearItem("g1", { variants: [], affiliateUrl: "HTTPS://shop.example.com/new" });
    assert.equal((updates[0].data.variants as { create: Array<Record<string, unknown>> }).create[0].affiliateUrl, "HTTPS://shop.example.com/new");
});

test("create: an unsafe variant link, or an unsafe item link that would become the Default's, is rejected with no write", async () => {
    const { createGearItem } = await import("./gearService");
    reset();
    await assert.rejects(createGearItem({ ...NEW_ITEM, variants: [variant("javascript:alert(1)")] }), InvalidGearInputError);
    await assert.rejects(createGearItem({ ...NEW_ITEM, affiliateUrl: "ftp://x.example/" }), InvalidGearInputError);
    assert.equal(creates.length, 0);
});

test("create: valid links, uppercase schemes, blank-to-null and null/omitted", async () => {
    const { createGearItem } = await import("./gearService");
    reset();
    await createGearItem({ ...NEW_ITEM, affiliateUrl: "HTTPS://shop.example.com/x" });
    assert.equal((creates[0].data.variants as { create: Array<Record<string, unknown>> }).create[0].affiliateUrl, "HTTPS://shop.example.com/x");
    reset();
    await createGearItem({ ...NEW_ITEM, variants: [variant("http://shop.example.com/a"), variant(""), variant(null), { label: "O", gender: "men" }] });
    assert.deepEqual((creates[0].data.variants as { create: Array<Record<string, unknown>> }).create.map((entry) => entry.affiliateUrl), ["http://shop.example.com/a", null, null, undefined]);
    reset();
    await createGearItem({ ...NEW_ITEM });
    assert.equal((creates[0].data.variants as { create: Array<Record<string, unknown>> }).create[0].affiliateUrl, null);
});

test("upsert and bulk upsert refuse unsafe links per item as 'invalid input', write nothing for them, and continue", async () => {
    const { upsertGearItem, bulkUpsertGearItems } = await import("./gearService");
    reset();
    await assert.rejects(upsertGearItem({ ...NEW_ITEM, variants: [variant("javascript:alert(1)")] }), InvalidGearInputError);
    assert.equal(creates.length + updates.length, 0);

    const result = await bulkUpsertGearItems([
        { ...NEW_ITEM, name: "Bad One", affiliateUrl: "javascript:alert(1)" },
        { ...NEW_ITEM, name: "Good One", affiliateUrl: "https://shop.example.com/good" },
        { ...NEW_ITEM, name: "Bad Variant", variants: [variant("data:text/html,x")] },
    ]);
    assert.deepEqual(result.failed.map((entry) => [entry.name, entry.reason]), [["Bad One", "invalid input"], ["Bad Variant", "invalid input"]]);
    assert.equal(result.inserted, 1);
    assert.equal(creates.length, 1);
    assert.equal(safeWriteFailureReason(new InvalidGearInputError("anything SECRET-TOKEN")), "invalid input");
});

test("no stored row was modified by any of the above, and no call other than create/update reached the fake", () => {
    assert.equal(JSON.stringify(stored), snapshot);
});
