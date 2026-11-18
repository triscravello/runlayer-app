import assert from "node:assert/strict";
import test from "node:test";
// Only PURE modules are imported statically: ES imports are hoisted above the fake below, and anything that reaches
// lib/prisma would otherwise build a real client. Everything else is imported dynamically, after the fake is installed.
import { InvalidGearInputError } from "@/lib/gear/inputErrors";
import { safeWriteFailureReason } from "@/lib/ingestion/writeRecovery";
import { createRecordingGearClient } from "../test-support/gearStoreFake";

// Defense in depth: even if a real client were ever built, it could only point at a closed loopback port, never at the
// DATABASE_URL from .env (Prisma does not override a variable that is already set).
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never";

// Direct-service input hardening (create, update, upsert, bulk). Real service and repository; recording fake in place of Prisma.
type Call = { where?: { id: string }; data: Record<string, unknown> };
const updates: Call[] = [];
const creates: Call[] = [];
const stored = {
    id: "g1", name: "Trail Tee", brandId: "b1", genderTarget: "men", category: "TOP", subcategory: "tee", priceRange: "MID",
    tags: ["keep"], bodyTypeFit: ["slim"], imageUrl: "https://e.test/i.png", affiliateUrl: "https://e.test/b",
    createdAt: new Date(0), updatedAt: new Date(0), brand: { id: "b1" },
    variants: [{ id: "v1", gearItemId: "g1", createdAt: new Date(0), updatedAt: new Date(0), label: "A", gender: "men", affiliateUrl: "https://e.test/a", imageUrl: null, price: null, sizes: [] }],
};
(globalThis as unknown as { prisma: unknown }).prisma = {
    $transaction: createRecordingGearClient(updates as never, (id) => (id === stored.id ? (stored as never) : null)).$transaction,
    gearItem: {
        findMany: async () => [stored],
        findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, true> }) => (where.id === stored.id ? Object.fromEntries(Object.keys(select).map((key) => [key, (stored as Record<string, unknown>)[key]])) : null),
        create: async (args: Call) => { creates.push(args); return { id: "new" }; },
    },
};
test("sentinel: the recording fake, not a real Prisma client, is the client in use", async () => {
    const { prisma } = await import("@/lib/prisma");
    assert.equal(prisma, (globalThis as unknown as { prisma: unknown }).prisma);
    assert.equal(typeof (prisma as unknown as { $connect?: unknown }).$connect, "undefined", "a real PrismaClient would have $connect");
});

const reset = () => { updates.length = 0; creates.length = 0; };
const NEW_ITEM = { name: "Brand New", brandId: "b1", category: "TOP", priceRange: "MID", affiliateUrl: null } as const;

const BAD_TAGS: Array<[string, unknown]> = [["null", null], ["string", "abc"], ["object", {}], ["number", 5], ["[1]", [1]], ["[null]", [null]], ["[[]]", [[]]], ["operator", { push: "x" }]];
const BAD_VARIANTS: Array<[string, unknown]> = [["null", null], ["empty object", {}], ["string", "abc"], ["length-bearing object", { length: 1 }], ["number", 5], ["[null]", [null]], ["[1]", [1]], ["[[]]", [[]]], ["operator object", { deleteMany: {}, create: [] }]];

// --- Rejection: every path, nothing written ---------------------------------------------------------------------------

for (const [label, value] of BAD_TAGS) {
    test(`tags ${label} is refused with a controlled error on create, update and upsert, with no write`, async () => {
        const { createGearItem, updateGearItem, upsertGearItem } = await import("./gearService");
        reset();
        await assert.rejects(createGearItem({ ...NEW_ITEM, tags: value } as never), InvalidGearInputError);
        await assert.rejects(updateGearItem("g1", { tags: value } as never), InvalidGearInputError);
        await assert.rejects(upsertGearItem({ ...NEW_ITEM, tags: value } as never), InvalidGearInputError);
        await assert.rejects(upsertGearItem({ ...NEW_ITEM, name: "Trail Tee", tags: value } as never), InvalidGearInputError);
        assert.equal(creates.length + updates.length, 0);
    });
}

for (const [label, value] of BAD_VARIANTS) {
    test(`variants ${label} is refused with a controlled error on create, update and upsert, and never replaces stored variants`, async () => {
        const { createGearItem, updateGearItem, upsertGearItem } = await import("./gearService");
        reset();
        await assert.rejects(createGearItem({ ...NEW_ITEM, variants: value } as never), InvalidGearInputError);
        await assert.rejects(updateGearItem("g1", { variants: value } as never), InvalidGearInputError);
        await assert.rejects(upsertGearItem({ ...NEW_ITEM, variants: value } as never), InvalidGearInputError);
        await assert.rejects(upsertGearItem({ ...NEW_ITEM, name: "Trail Tee", variants: value } as never), InvalidGearInputError);
        assert.equal(creates.length + updates.length, 0, "no write, so no Default variant replaced the stored ones");
    });
}

test("a non-object payload is refused", async () => {
    const { createGearItem, upsertGearItem } = await import("./gearService");
    for (const bad of [null, undefined, "x", 5, [], [{}]]) {
        await assert.rejects(createGearItem(bad as never), InvalidGearInputError);
        await assert.rejects(upsertGearItem(bad as never), InvalidGearInputError);
    }
});

test("error messages are fixed text: no submitted value ever appears", async () => {
    const { createGearItem, updateGearItem } = await import("./gearService");
    const secret = "SECRET-VALUE-12345";
    for (const run of [
        () => createGearItem({ ...NEW_ITEM, tags: [secret, 1] } as never),
        () => updateGearItem("g1", { variants: secret } as never),
        () => updateGearItem("g1", { variants: [{ label: secret, gender: 5 }] } as never),
        () => createGearItem({ ...NEW_ITEM, variants: [{ label: "a", gender: "men", [secret]: 1 }] } as never),
    ]) {
        const error = await run().then(() => null, (caught: unknown) => caught as Error);
        assert.ok(error instanceof InvalidGearInputError);
        assert.equal(error.message.includes(secret), false, error.message);
    }
});

test("InvalidGearUpdateError is an InvalidGearInputError, and both map to the fixed reason 'invalid input'", async () => {
    const { InvalidGearUpdateError } = await import("@/lib/db/gearRepository");
    assert.ok(new InvalidGearUpdateError("x") instanceof InvalidGearInputError);
    assert.equal(safeWriteFailureReason(new InvalidGearInputError("Invalid gear input: with SECRET")), "invalid input");
    assert.equal(safeWriteFailureReason(new InvalidGearUpdateError("with SECRET")), "invalid input");
    assert.equal(safeWriteFailureReason(new Error("boom")), "unexpected error");
});

// --- Preserved behavior ----------------------------------------------------------------------------------------------

test("variants: [] keeps its approved meaning on create and update: a Default variant is synthesized", async () => {
    const { createGearItem, updateGearItem } = await import("./gearService");
    reset();
    await updateGearItem("g1", { variants: [] });
    assert.deepEqual((updates[0].data.variants as { create: Array<{ label: string }> }).create.map((variant) => variant.label), ["Default"]);
    await createGearItem({ ...NEW_ITEM, variants: [] });
    assert.deepEqual(((creates[0].data.variants as { create: Array<{ label: string }> })).create.map((variant) => variant.label), ["Default"]);
});

test("omitted variants: update sends no variants operation; create synthesizes a Default", async () => {
    const { createGearItem, updateGearItem } = await import("./gearService");
    reset();
    await updateGearItem("g1", { name: "Renamed" });
    assert.equal("variants" in updates[0].data, false);
    await createGearItem({ ...NEW_ITEM });
    assert.equal((creates[0].data.variants as { create: unknown[] }).create.length, 1);
});

test("tags: [] clears on update; omitted tags are kept on update and default to [] on create", async () => {
    const { createGearItem, updateGearItem } = await import("./gearService");
    reset();
    await updateGearItem("g1", { tags: [] });
    assert.deepEqual(updates[0].data.tags, []);
    await updateGearItem("g1", { name: "Renamed" });
    assert.equal("tags" in updates[1].data, false, "omitted tags are not written, so the stored ones are kept");
    await createGearItem({ ...NEW_ITEM });
    assert.deepEqual(creates[0].data.tags, []);
});

test("valid variants produce exactly the data they always did, on create and update", async () => {
    const { createGearItem, updateGearItem } = await import("./gearService");
    const variants = [{ label: " Men ", gender: "men", affiliateUrl: "https://e.test/m", price: 20, sizes: ["S"] }, { label: "W", gender: "women" }];
    const expected = { create: [
        { label: " Men ", gender: "men", affiliateUrl: "https://e.test/m", imageUrl: undefined, price: 20, sizes: ["S"] },
        { label: "W", gender: "women", affiliateUrl: undefined, imageUrl: undefined, price: undefined, sizes: [] },
    ] };
    reset();
    await createGearItem({ ...NEW_ITEM, variants });
    assert.deepEqual(creates[0].data.variants, expected);
    await updateGearItem("g1", { variants });
    assert.deepEqual(updates[0].data.variants, { deleteMany: {}, ...expected });
});

// --- Explicit undefined is omission; null and [] still clear -----------------------------------------------------------

test("explicitly supplied undefined is treated as omitted on update", async () => {
    const { updateGearItem } = await import("./gearService");
    reset();
    await updateGearItem("g1", { name: "Renamed", tags: undefined, bodyTypeFit: undefined, genderTarget: undefined, subcategory: undefined, imageUrl: undefined, affiliateUrl: undefined, variants: undefined, weatherSuitability: undefined, category: undefined, priceRange: undefined, brandId: undefined });
    const { data } = updates[0];
    assert.deepEqual(Object.keys(data), ["name"], "explicit undefined is omission: nothing but the name is written");
    assert.equal("variants" in data, false);
    for (const column of ["weatherHot", "weatherCold", "weatherRain", "weatherWind"]) assert.equal(data[column], undefined);
});

test("explicit null still clears the nullable fields, and [] clears the arrays", async () => {
    const { updateGearItem } = await import("./gearService");
    reset();
    await updateGearItem("g1", { genderTarget: null, subcategory: null, imageUrl: null, affiliateUrl: null, tags: [], bodyTypeFit: [] });
    const { data } = updates[0];
    assert.deepEqual([data.genderTarget, data.subcategory, data.imageUrl, data.affiliateUrl], [null, null, null, null]);
    assert.deepEqual([data.tags, data.bodyTypeFit], [[], []]);
    // Scores that have no legacy alias clear with null. (`hot` is deliberately not asserted: its legacy `warm` alias makes
    // `hot: null` a no-op today, a pre-existing behavior this change does not touch.)
    await updateGearItem("g1", { weatherSuitability: { cold: null, rain: null, wind: 0.2 } });
    assert.equal(updates[1].data.weatherCold, null);
    assert.equal(updates[1].data.weatherRain, null);
    assert.equal(updates[1].data.weatherWind, 0.2);
});

// --- Create path uses the same variant validation as update ------------------------------------------------------------

test("create refuses a variant that update would refuse", async () => {
    const { createGearItem } = await import("./gearService");
    const bad = [
        [{ label: 1, gender: 5 }],
        [{ label: "a", gender: "men", gearItem: { connect: { id: "z" } } }],
        [{ label: "a", gender: "men", price: { increment: 1 } }],
        [{ label: " ", gender: "men" }],
        [{ label: "a", gender: "men", sizes: "S" }],
    ];
    for (const variants of bad) {
        reset();
        await assert.rejects(createGearItem({ ...NEW_ITEM, variants } as never), InvalidGearInputError);
        assert.equal(creates.length, 0);
    }
});

// --- Bulk: one malformed item must not take the batch down -------------------------------------------------------------

test("bulk upsert reports malformed items as 'invalid input' and still writes the valid ones", async () => {
    const { bulkUpsertGearItems } = await import("./gearService");
    reset();
    const good = (name: string) => ({ ...NEW_ITEM, name });
    const result = await bulkUpsertGearItems([
        good("Good One"),
        { ...good("Bad Tags"), tags: null },
        { ...good("Bad Variants"), variants: {} },
        null,
        { ...good("Bad Variant Field"), variants: [{ label: 1, gender: 5 }] },
        good("Good Two"),
    ] as never);

    assert.equal(result.inserted, 2);
    assert.equal(result.updated, 0);
    assert.equal(result.total, 3, "unique well-formed items that were attempted");
    assert.deepEqual(result.failed.map((failure) => failure.reason), ["invalid input", "invalid input", "invalid input", "invalid input"]);
    assert.deepEqual(result.failed.map((failure) => failure.name).sort(), ["(invalid item)", "Bad Tags", "Bad Variant Field", "Bad Variants"].sort());
    assert.deepEqual(creates.map((call) => call.data.name).sort(), ["Good One", "Good Two"]);
});

test("bulk upsert of valid items is unchanged: inserts, updates and counts", async () => {
    const { bulkUpsertGearItems } = await import("./gearService");
    reset();
    const result = await bulkUpsertGearItems([{ ...NEW_ITEM, name: "Fresh" }, { ...NEW_ITEM, name: "Trail Tee" }]);
    assert.deepEqual({ total: result.total, inserted: result.inserted, updated: result.updated, failed: result.failed.length }, { total: 2, inserted: 1, updated: 1, failed: 0 });
});
