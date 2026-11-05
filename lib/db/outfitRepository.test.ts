import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { mapOutfitWriteError, OutfitValidationError, saveOutfit, updateSavedOutfit, type OutfitTransactionRunner } from "./outfitRepository";

type Row = Record<string, unknown> & { id: string };
type State = { outfits: Row[]; items: Row[]; gear: Row[]; recommendations: Row[] };

const SECRET = "SECRET-CLIENT-ID-77";

function prismaError(code: string, meta?: unknown) {
    const error = new Error("Invalid `prisma.outfitItem.createMany()` invocation: do-not-leak");
    error.name = "PrismaClientKnownRequestError";
    Object.assign(error, { code, meta });
    return error;
}

/**
 * In-memory stand-in for the database. Its transaction really rolls back (state is snapshotted and restored when the
 * callback throws), and it enforces the locking protocol: item writes on an outfit are only allowed after that outfit
 * was locked, by its owner, in the same transaction.
 */
function createFake(initial: Partial<State> = {}, options: { failCreateMany?: unknown } = {}) {
    let state: State = structuredClone({ outfits: [], items: [], gear: [], recommendations: [], ...initial });
    const calls: string[] = [];
    const writes: string[] = [];
    let transactions = 0;
    let nextId = 1;
    let locked = new Set<string>();

    const withItems = (outfit: Row) => ({ ...outfit, OutfitItem: state.items.filter((item) => item.outfitId === outfit.id) });

    const tx = {
        $queryRaw: async (_strings: TemplateStringsArray, outfitId: string, userId: string) => {
            calls.push("lock");
            const rows = state.outfits.filter((outfit) => outfit.id === outfitId && outfit.userId === userId);
            if (rows.length) locked.add(outfitId);
            return rows.map((outfit) => ({ id: outfit.id }));
        },
        recommendation: {
            findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
                calls.push("recommendation.findFirst");
                return state.recommendations.find((row) => row.id === where.id && row.userId === where.userId) ?? null;
            },
        },
        gearItem: {
            findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
                calls.push("gearItem.findMany");
                // Returned in reverse so the repository cannot rely on the database's order.
                return state.gear.filter((row) => where.id.in.includes(row.id)).reverse();
            },
        },
        savedOutfit: {
            create: async ({ data }: { data: Record<string, unknown> }) => {
                calls.push("savedOutfit.create");
                const row: Row = { id: `outfit-${nextId++}`, ...data };
                state.outfits.push(row);
                return row;
            },
            updateMany: async ({ where, data }: { where: { id: string; userId: string }; data: Record<string, unknown> }) => {
                calls.push("savedOutfit.updateMany");
                writes.push(`updateMany:${JSON.stringify(data)}`);
                const row = state.outfits.find((outfit) => outfit.id === where.id && outfit.userId === where.userId);
                if (row) Object.assign(row, data);
                return { count: row ? 1 : 0 };
            },
            findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
                calls.push("savedOutfit.findFirst");
                const row = state.outfits.find((outfit) => outfit.id === where.id && outfit.userId === where.userId);
                return row ? withItems(row) : null;
            },
        },
        outfitItem: {
            deleteMany: async ({ where }: { where: { outfitId: string } }) => {
                calls.push("outfitItem.deleteMany");
                assert.ok(locked.has(where.outfitId), "outfit items replaced without holding the row lock");
                state.items = state.items.filter((item) => item.outfitId !== where.outfitId);
                return { count: 0 };
            },
            createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
                calls.push("outfitItem.createMany");
                assert.ok(data.every((item) => locked.has(item.outfitId as string)), "outfit items created without holding the row lock");
                if (options.failCreateMany) throw options.failCreateMany;
                for (const item of data) state.items.push({ id: `item-${nextId++}`, ...item });
                return { count: data.length };
            },
        },
    };

    const client = {
        $transaction: async (fn: (client: typeof tx) => Promise<unknown>, transactionOptions?: unknown) => {
            transactions += 1;
            calls.push(`begin:${JSON.stringify(transactionOptions)}`);
            const snapshot = structuredClone(state);
            locked = new Set();
            try {
                const result = await fn(tx);
                calls.push("commit");
                return result;
            } catch (error) {
                state = snapshot;
                calls.push("rollback");
                throw error;
            }
        },
    } as unknown as OutfitTransactionRunner;

    return { client, calls, writes, transactions: () => transactions, state: () => state };
}

const GEAR: Row[] = [
    { id: "g1", category: "TOP" },
    { id: "g2", category: "BOTTOM" },
    { id: "g3", category: "ACCESSORY" },
];
const ORIGINAL_UPDATED_AT = new Date("2020-01-01T00:00:00.000Z");
const OWNED: Row = { id: "outfit-a", userId: "user-a", name: "Original", description: "Original description", type: "trail", isFavorite: true, updatedAt: ORIGINAL_UPDATED_AT };
const OWNED_ITEMS: Row[] = [{ id: "i1", outfitId: "outfit-a", gearItemId: "g1", category: "TOP" }];
const seeded = () => ({ gear: GEAR, outfits: [OWNED], items: OWNED_ITEMS, recommendations: [{ id: "rec-a", userId: "user-a" }, { id: "rec-b", userId: "user-b" }] });
const calls = (fake: ReturnType<typeof createFake>) => fake.calls.filter((call) => !call.startsWith("begin:"));

// --- create -------------------------------------------------------------------------------------------------------

test("create validates, locks and writes inside one bounded transaction, in order", async () => {
    const fake = createFake(seeded());
    const created = (await saveOutfit({ userId: "user-a", recommendationId: "rec-a", name: "New", gearItemIds: ["g1", "g2"], type: "race_day" }, fake.client)) as unknown as Row;

    assert.equal(fake.transactions(), 1);
    assert.match(fake.calls[0], /^begin:\{"maxWait":\d+,"timeout":\d+\}$/, "bounded transaction");
    assert.deepEqual(calls(fake), [
        "recommendation.findFirst",
        "gearItem.findMany",
        "savedOutfit.create",
        "lock",
        "outfitItem.deleteMany",
        "outfitItem.createMany",
        "savedOutfit.findFirst",
        "commit",
    ]);
    assert.equal(created.type, "race-day", "the race_day alias is normalized");
    assert.equal(created.userId, "user-a");
    assert.deepEqual((created.OutfitItem as Row[]).map((item) => item.gearItemId), ["g1", "g2"], "requested order is kept");
});

test("create defaults: unnamed kits are 'Saved Kit' and a missing kit type falls back to favorites", async () => {
    const fake = createFake(seeded());
    const created = (await saveOutfit({ userId: "user-a", gearItemIds: ["g1"] }, fake.client)) as unknown as Row;

    assert.equal(created.name, "Saved Kit");
    assert.equal(created.type, "favorites");
    assert.equal(created.isFavorite, false);
    assert.equal(created.recommendationId, null);
});

test("create de-duplicates repeated gear ids", async () => {
    const fake = createFake(seeded());
    const created = (await saveOutfit({ userId: "user-a", gearItemIds: ["g1", " g1 ", "g2", "g1"] }, fake.client)) as unknown as Row;

    assert.deepEqual((created.OutfitItem as Row[]).map((item) => item.gearItemId), ["g1", "g2"]);
});

test("create rejects bad input before any transaction is opened", async () => {
    const fake = createFake(seeded());
    const cases: Array<[string, Parameters<typeof saveOutfit>[0], string]> = [
        ["no gear field", { userId: "user-a" }, "Select at least one gear item."],
        ["null gear", { userId: "user-a", gearItemIds: null }, "Select at least one gear item."],
        ["empty gear", { userId: "user-a", gearItemIds: [] }, "Select at least one gear item."],
        ["too many", { userId: "user-a", gearItemIds: Array.from({ length: 31 }, (_, i) => `g${i}`) }, "A kit can contain at most 30 gear items."],
        ["blank id", { userId: "user-a", gearItemIds: ["g1", "  "] }, "Invalid gear item id."],
        ["long id", { userId: "user-a", gearItemIds: ["x".repeat(65)] }, "Invalid gear item id."],
        ["unknown type", { userId: "user-a", gearItemIds: ["g1"], type: SECRET }, "Unsupported kit type."],
    ];

    for (const [label, input, message] of cases) {
        await assert.rejects(saveOutfit(input, fake.client), (error: unknown) => error instanceof OutfitValidationError && error.statusCode === 400 && error.message === message, label);
    }
    assert.equal(fake.transactions(), 0);
});

test("create with a recommendation the user does not own fails with 404 and writes nothing", async () => {
    const fake = createFake(seeded());

    await assert.rejects(
        saveOutfit({ userId: "user-a", recommendationId: "rec-b", gearItemIds: ["g1"] }, fake.client),
        (error: unknown) => error instanceof OutfitValidationError && error.statusCode === 404,
    );
    assert.equal(fake.calls.includes("savedOutfit.create"), false);
    assert.equal(fake.state().outfits.length, 1, "no outfit was created");
});

test("create with an unknown gear id fails with 400, writes nothing and does not echo the id", async () => {
    const fake = createFake(seeded());

    await assert.rejects(
        saveOutfit({ userId: "user-a", gearItemIds: ["g1", SECRET] }, fake.client),
        (error: unknown) => error instanceof OutfitValidationError && error.statusCode === 400 && !error.message.includes(SECRET),
    );
    assert.equal(fake.calls.includes("savedOutfit.create"), false);
    assert.equal(fake.state().outfits.length, 1);
});

test("create rolls back the new outfit if writing its items fails", async () => {
    const fake = createFake(seeded(), { failCreateMany: prismaError("P2003", { field_name: "outfit_items_gear_item_id_fkey (index)" }) });

    await assert.rejects(
        saveOutfit({ userId: "user-a", gearItemIds: ["g1"] }, fake.client),
        (error: unknown) => error instanceof OutfitValidationError && error.statusCode === 409 && error.message === "A selected gear item is no longer available.",
    );
    assert.ok(fake.calls.includes("rollback"));
    assert.equal(fake.state().outfits.length, 1, "no orphan outfit is left behind");
    assert.equal(fake.state().items.length, 1);
});

// --- update -------------------------------------------------------------------------------------------------------

test("update locks the owned row first, validates references, then writes metadata and items", async () => {
    const fake = createFake(seeded());
    const updated = (await updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", name: "Renamed", gearItemIds: ["g2", "g3"], type: "rain" }, fake.client)) as unknown as Row;

    assert.deepEqual(calls(fake), [
        "lock",
        "savedOutfit.findFirst", // current stored state, read under the lock
        "gearItem.findMany",
        "savedOutfit.updateMany",
        "outfitItem.deleteMany",
        "outfitItem.createMany",
        "savedOutfit.findFirst",
        "commit",
    ]);
    assert.equal(updated.name, "Renamed");
    assert.equal(updated.type, "rain");
    assert.deepEqual((updated.OutfitItem as Row[]).map((item) => item.gearItemId), ["g2", "g3"]);
});

test("update of a missing outfit or another user's outfit returns null and changes nothing", async () => {
    for (const [userId, outfitId] of [["user-b", "outfit-a"], ["user-a", "does-not-exist"]]) {
        const fake = createFake(seeded());
        const result = await updateSavedOutfit({ userId, outfitId, name: "Hijacked", gearItemIds: ["g2"] }, fake.client);

        assert.equal(result, null);
        assert.deepEqual(calls(fake), ["lock", "commit"], "only the ownership lock query ran");
        assert.deepEqual(fake.state().outfits, [OWNED]);
        assert.deepEqual(fake.state().items, OWNED_ITEMS);
    }
});

test("update validates gear before any write: a bad id leaves metadata and items untouched", async () => {
    const fake = createFake(seeded());

    await assert.rejects(
        updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", name: "Should not apply", gearItemIds: ["g2", SECRET] }, fake.client),
        (error: unknown) => error instanceof OutfitValidationError && error.statusCode === 400 && !error.message.includes(SECRET),
    );
    assert.equal(fake.calls.includes("savedOutfit.updateMany"), false);
    assert.equal(fake.calls.includes("outfitItem.deleteMany"), false);
    assert.deepEqual(fake.state().outfits, [OWNED]);
    assert.deepEqual(fake.state().items, OWNED_ITEMS);
});

test("update rolls back both metadata and items if replacing the items fails", async () => {
    const fake = createFake(seeded(), { failCreateMany: prismaError("P2003", { field_name: "outfit_items_gear_item_id_fkey (index)" }) });

    await assert.rejects(
        updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", name: "Half applied?", isFavorite: false, gearItemIds: ["g2"] }, fake.client),
        (error: unknown) => error instanceof OutfitValidationError && error.statusCode === 409,
    );
    assert.ok(fake.calls.indexOf("outfitItem.deleteMany") < fake.calls.indexOf("rollback"), "the delete had happened before the failure");
    assert.deepEqual(fake.state().outfits, [OWNED], "name and favorite flag are restored");
    assert.deepEqual(fake.state().items, OWNED_ITEMS, "the original items are restored");
});

test("update without gearItemIds leaves the items alone; null and undefined metadata mean 'no change' for the kit type", async () => {
    for (const gearItemIds of [undefined, null]) {
        const fake = createFake(seeded());
        const updated = (await updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", name: "Only a name", type: null, category: undefined, gearItemIds }, fake.client)) as unknown as Row;

        assert.equal(updated.name, "Only a name");
        assert.equal(updated.type, "trail", "a null type no longer overwrites the stored kit type");
        assert.equal(fake.calls.includes("outfitItem.deleteMany"), false);
        assert.equal(fake.calls.includes("gearItem.findMany"), false);
        assert.deepEqual(fake.state().items, OWNED_ITEMS);
    }
});

test("update keeps the existing null semantics for description and isFavorite", async () => {
    const fake = createFake(seeded());
    const updated = (await updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", description: null, isFavorite: null }, fake.client)) as unknown as Row;

    assert.equal(updated.description, null);
    assert.equal(updated.isFavorite, false);
});

test("update with no fields at all still checks ownership and returns the outfit without writing", async () => {
    const fake = createFake(seeded());
    const updated = (await updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a" }, fake.client)) as unknown as Row;

    assert.equal(updated.id, "outfit-a");
    assert.equal(fake.calls.includes("savedOutfit.updateMany"), false);
});

test("update rejects an empty list and an unknown kit type before opening a transaction", async () => {
    const fake = createFake(seeded());

    await assert.rejects(updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", gearItemIds: [] }, fake.client), (error: unknown) => error instanceof OutfitValidationError && error.message === "Select at least one gear item.");
    await assert.rejects(updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", type: "marathon" }, fake.client), (error: unknown) => error instanceof OutfitValidationError && error.message === "Unsupported kit type.");
    assert.equal(fake.transactions(), 0);
});

// --- updatedAt ----------------------------------------------------------------------------------------------------

const FIXED_NOW = new Date("2024-06-01T12:00:00.000Z");
const updateManyData = (fake: ReturnType<typeof createFake>) => fake.writes.filter((write) => write.startsWith("updateMany:")).map((write) => JSON.parse(write.slice("updateMany:".length)));

async function withFixedClock<T>(t: TestContext, work: () => Promise<T>): Promise<T> {
    t.mock.timers.reset(); // safe to call repeatedly within one test
    t.mock.timers.enable({ apis: ["Date"], now: FIXED_NOW });
    return work();
}

test("an item-only change advances updatedAt, in the same transaction as the item replacement", async (t) => {
    const fake = createFake(seeded());
    await withFixedClock(t, () => updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", gearItemIds: ["g2", "g3"] }, fake.client));

    assert.deepEqual(updateManyData(fake), [{ updatedAt: FIXED_NOW.toISOString() }], "only the timestamp is written");
    assert.equal((fake.state().outfits[0].updatedAt as Date).getTime(), FIXED_NOW.getTime());
    const begin = fake.calls.findIndex((call) => call.startsWith("begin:"));
    const touch = fake.calls.indexOf("savedOutfit.updateMany");
    const replace = fake.calls.indexOf("outfitItem.createMany");
    const commit = fake.calls.indexOf("commit");
    assert.ok(begin < touch && touch < replace && replace < commit, "touch and replacement are both inside begin..commit");
});

test("a metadata change advances updatedAt with exactly the changed fields", async (t) => {
    const fake = createFake(seeded());
    await withFixedClock(t, () => updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", name: "Renamed", description: "Original description", isFavorite: true }, fake.client));

    assert.deepEqual(updateManyData(fake), [{ name: "Renamed", updatedAt: FIXED_NOW.toISOString() }], "unchanged fields are not rewritten");
    assert.equal(fake.calls.includes("outfitItem.deleteMany"), false);
    assert.equal((fake.state().outfits[0].updatedAt as Date).getTime(), FIXED_NOW.getTime());
});

test("a combined metadata and item change writes one update and replaces the items", async (t) => {
    const fake = createFake(seeded());
    await withFixedClock(t, () => updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", type: "rain", gearItemIds: ["g3"] }, fake.client));

    assert.deepEqual(updateManyData(fake), [{ type: "rain", updatedAt: FIXED_NOW.toISOString() }]);
    assert.deepEqual(fake.state().items.map((item) => item.gearItemId), ["g3"]);
});

test("changing only the items does not rewrite the metadata columns", async (t) => {
    const fake = createFake(seeded());
    await withFixedClock(t, () => updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", name: "Original", isFavorite: true, type: "trail", gearItemIds: ["g2"] }, fake.client));

    assert.deepEqual(updateManyData(fake), [{ updatedAt: FIXED_NOW.toISOString() }]);
    assert.equal(fake.state().outfits[0].name, "Original");
});

test("no-op updates write nothing and leave updatedAt alone", async (t) => {
    const noOps: Array<[string, Partial<Parameters<typeof updateSavedOutfit>[0]>]> = [
        ["no fields", {}],
        ["null items", { gearItemIds: null }],
        ["identical metadata", { name: "Original", description: "Original description", isFavorite: true, type: "trail" }],
        ["identical items", { gearItemIds: ["g1"] }],
        ["identical items with repeats and padding", { gearItemIds: [" g1 ", "g1"] }],
        ["identical everything", { name: "Original", type: "trail", isFavorite: true, gearItemIds: ["g1"] }],
        ["null type means no change", { type: null }],
    ];

    for (const [label, fields] of noOps) {
        const fake = createFake(seeded());
        const result = (await withFixedClock(t, () => updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", ...fields }, fake.client))) as unknown as Row;

        assert.equal(result.id, "outfit-a", `${label}: still returns the outfit`);
        assert.equal(fake.calls.includes("savedOutfit.updateMany"), false, `${label}: no update`);
        assert.equal(fake.calls.includes("outfitItem.deleteMany"), false, `${label}: no item delete`);
        assert.equal(fake.calls.includes("outfitItem.createMany"), false, `${label}: no item insert`);
        assert.deepEqual(fake.state().outfits, [OWNED], `${label}: updatedAt and metadata untouched`);
        assert.deepEqual(fake.state().items, OWNED_ITEMS, `${label}: the very same item rows`);
    }
});

test("a no-op is decided order-insensitively, and only a real set difference counts as a change", async (t) => {
    const twoItems = { ...seeded(), items: [...OWNED_ITEMS, { id: "i2", outfitId: "outfit-a", gearItemId: "g2", category: "BOTTOM" }] };

    const same = createFake(twoItems);
    await withFixedClock(t, () => updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", gearItemIds: ["g2", "g1"] }, same.client));
    assert.equal(same.calls.includes("savedOutfit.updateMany"), false, "same set in another order is a no-op");

    for (const different of [["g1"], ["g1", "g2", "g3"], ["g1", "g3"]]) {
        const fake = createFake(twoItems);
        await withFixedClock(t, () => updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", gearItemIds: different }, fake.client));
        assert.equal(fake.calls.includes("savedOutfit.updateMany"), true, `${different.join(",")} is a real change`);
    }
});

test("isFavorite null counts as false when deciding whether anything changed", async (t) => {
    const notFavorite = { ...seeded(), outfits: [{ ...OWNED, isFavorite: false }] };

    const unchanged = createFake(notFavorite);
    await withFixedClock(t, () => updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", isFavorite: null }, unchanged.client));
    assert.equal(unchanged.calls.includes("savedOutfit.updateMany"), false);

    const changed = createFake(seeded());
    await withFixedClock(t, () => updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", isFavorite: null }, changed.client));
    assert.deepEqual(updateManyData(changed), [{ isFavorite: false, updatedAt: FIXED_NOW.toISOString() }]);
});

test("validation still runs for a no-op item list: a missing gear id is rejected even if the set 'matches'", async (t) => {
    const fake = createFake(seeded());
    await assert.rejects(
        withFixedClock(t, () => updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", gearItemIds: ["g1", SECRET] }, fake.client)),
        (error: unknown) => error instanceof OutfitValidationError && error.statusCode === 400,
    );
    assert.deepEqual(fake.state().outfits, [OWNED]);
});

test("a failed update rolls the timestamp back together with the metadata and items", async (t) => {
    const fake = createFake(seeded(), { failCreateMany: prismaError("P2003", { field_name: "outfit_items_gear_item_id_fkey (index)" }) });

    await assert.rejects(withFixedClock(t, () => updateSavedOutfit({ userId: "user-a", outfitId: "outfit-a", name: "Half applied?", gearItemIds: ["g2"] }, fake.client)));

    assert.ok(fake.calls.indexOf("savedOutfit.updateMany") < fake.calls.indexOf("rollback"), "the timestamp had been written before the failure");
    assert.equal((fake.state().outfits[0].updatedAt as Date).getTime(), ORIGINAL_UPDATED_AT.getTime(), "updatedAt is restored");
    assert.deepEqual(fake.state().outfits, [OWNED]);
});

test("ownership still gates the timestamp: another user's update neither reads nor touches the outfit", async (t) => {
    const fake = createFake(seeded());
    const result = await withFixedClock(t, () => updateSavedOutfit({ userId: "user-b", outfitId: "outfit-a", name: "Hijacked", gearItemIds: ["g2"] }, fake.client));

    assert.equal(result, null);
    assert.deepEqual(calls(fake), ["lock", "commit"]);
    assert.equal((fake.state().outfits[0].updatedAt as Date).getTime(), ORIGINAL_UPDATED_AT.getTime());
});

// --- error mapping ------------------------------------------------------------------------------------------------

test("mapOutfitWriteError turns foreign-key failures into fixed messages and leaves everything else alone", () => {
    const gear = mapOutfitWriteError(prismaError("P2003", { field_name: "outfit_items_gear_item_id_fkey (index)" })) as OutfitValidationError;
    const recommendation = mapOutfitWriteError(prismaError("P2003", { field_name: "saved_outfits_recommendation_id_fkey (index)" })) as OutfitValidationError;
    const unknownField = mapOutfitWriteError(prismaError("P2003")) as OutfitValidationError;

    assert.deepEqual([gear.statusCode, gear.message], [409, "A selected gear item is no longer available."]);
    assert.deepEqual([recommendation.statusCode, recommendation.message], [404, "Recommendation not found for this user."]);
    assert.deepEqual([unknownField.statusCode, unknownField.message], [409, "A referenced record is no longer available."]);
    for (const mapped of [gear, recommendation, unknownField]) assert.doesNotMatch(mapped.message, /invocation|do-not-leak|prisma/i);

    const validation = new OutfitValidationError("x", 400);
    const other = new Error("boom");
    const otherPrisma = prismaError("P2002");
    assert.equal(mapOutfitWriteError(validation), validation);
    assert.equal(mapOutfitWriteError(other), other);
    assert.equal(mapOutfitWriteError(otherPrisma), otherPrisma, "only P2003 is mapped");
    assert.equal(mapOutfitWriteError("text"), "text");
});

// --- structural guard ---------------------------------------------------------------------------------------------

test("outfit items are written in exactly one place, which requires the row lock", () => {
    const source = readFileSync(fileURLToPath(new URL("./outfitRepository.ts", import.meta.url)), "utf8");
    const code = source.replace(/\/\/.*$/gm, "");

    assert.equal((code.match(/outfitItem\.deleteMany/g) ?? []).length, 1, "a single outfit_items delete");
    assert.equal((code.match(/outfitItem\.createMany/g) ?? []).length, 1, "a single outfit_items insert");
    assert.match(code, /async function replaceOutfitItems\(locked: LockedOutfit,/, "the writer demands proof of the lock");
    assert.match(code, /FOR UPDATE/, "the lock is a row-level FOR UPDATE");

    const callers = (code.match(/replaceOutfitItems\(/g) ?? []).length - 1; // minus the definition
    const lockCalls = (code.match(/await lockOwnedOutfit\(/g) ?? []).length;
    assert.equal(callers, 2, "create and update are the only callers");
    assert.equal(lockCalls, 2, "each caller takes the lock first");
    assert.equal((code.match(/prisma\.outfitItem|prisma\.savedOutfit\.(create|update|updateMany)\(/g) ?? []).length, 0, "no item or outfit write bypasses the transaction client");
});
