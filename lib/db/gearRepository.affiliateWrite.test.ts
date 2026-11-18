import assert from "node:assert/strict";
import test from "node:test";
import { InvalidGearInputError } from "@/lib/gear/inputErrors";
import { isSafeHttpUrl } from "@/lib/gear/externalUrl";
import { createRecordingGearClient } from "../../test-support/gearStoreFake";

// Only pure modules are imported statically (ES imports are hoisted above the fake below). A reserved, closed loopback URL is the
// last line of defense; the isolation launcher already neutralizes the real one.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never";

type Call = { where?: { id: string }; data: Record<string, unknown> };
const creates: Call[] = [];
const updates: Call[] = [];
(globalThis as unknown as { prisma: unknown }).prisma = {
    $transaction: createRecordingGearClient(updates as never).$transaction,
    gearItem: {
        create: async (args: Call) => { creates.push(args); return { id: "new" }; },
    },
};
const reset = () => { creates.length = 0; updates.length = 0; };
const ITEM = { name: "Trail Tee", brandId: "b1", category: "TOP", priceRange: "MID" } as const;
const variant = (affiliateUrl: unknown) => ({ label: "A", gender: "men", affiliateUrl });
const createdVariants = () => (creates[0].data.variants as { create: Array<Record<string, unknown>> }).create;
const updatedVariants = () => (updates[0].data.variants as { deleteMany: object; create: Array<Record<string, unknown>> }).create;

const BAD = ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://x.example/a", "//x.example/a", "not a url", "https://u:p@x.example/a", "https://x.example/a b", "https://x.example/\tb", ` https://x.example/a`, "https://x.example/a ", "\thttps://x.example/a\n", "\u0000", `https://x.example/${"a".repeat(2048)}`, 5, {}, [], true];

test("the repository refuses an invalid variant link on create and on update, and writes nothing", async () => {
    const { createGearItem, updateGearItem } = await import("./gearRepository");
    for (const value of BAD) {
        reset();
        await assert.rejects(createGearItem({ ...ITEM, variants: [variant(value)] } as never), InvalidGearInputError, String(value).slice(0, 30));
        await assert.rejects(updateGearItem({ id: "g1", variants: [variant(value)] } as never, {}, createRecordingGearClient(updates as never) as never), InvalidGearInputError);
        assert.equal(creates.length + updates.length, 0, String(value).slice(0, 30));
    }
});

test("the repository accepts exactly what the shared policy accepts, and stores a valid link as submitted", async () => {
    const { createGearItem } = await import("./gearRepository");
    for (const value of ["https://shop.example.com/x", "HTTPS://shop.example.com/X", "hTtP://shop.example.com/x?Q=1"]) {
        reset();
        assert.equal(isSafeHttpUrl(value), true);
        await createGearItem({ ...ITEM, variants: [variant(value)] } as never);
        assert.equal(createdVariants()[0].affiliateUrl, value);
    }
});

test("blank links are stored as null; null stays null; an omitted link stays unset", async () => {
    const { createGearItem, updateGearItem } = await import("./gearRepository");
    for (const blank of ["", " ", "  \t "]) {
        reset();
        await createGearItem({ ...ITEM, variants: [variant(blank)] } as never);
        assert.equal(createdVariants()[0].affiliateUrl, null);
        reset();
        await updateGearItem({ id: "g1", variants: [variant(blank)] } as never);
        assert.equal(updatedVariants()[0].affiliateUrl, null);
    }
    reset();
    await createGearItem({ ...ITEM, variants: [variant(null), { label: "B", gender: "men" }] } as never);
    assert.equal(createdVariants()[0].affiliateUrl, null);
    assert.equal(createdVariants()[1].affiliateUrl, undefined, "omitted stays unset (the column default applies)");
});

test("error messages are fixed text: no submitted link appears", async () => {
    const { createGearItem } = await import("./gearRepository");
    const error = await createGearItem({ ...ITEM, variants: [variant("javascript:SECRET-TOKEN")] } as never).catch((caught: Error) => caught);
    assert.ok(error instanceof InvalidGearInputError);
    assert.doesNotMatch(error.message, /SECRET-TOKEN/);
    assert.match(error.message, /variants\[0\]\.affiliateUrl must be an http\(s\) link/);
});

test("an update that does not send variants does not look at stored links; item-level repository behavior is unchanged", async () => {
    const { updateGearItem } = await import("./gearRepository");
    reset();
    await updateGearItem({ id: "g1", name: "Renamed", affiliateUrl: "javascript:legacy" } as never);
    assert.equal("variants" in updates[0].data, false);
    assert.equal(updates[0].data.affiliateUrl, "javascript:legacy", "item-level links are not policed by the repository: legacy values round-trip");
});
