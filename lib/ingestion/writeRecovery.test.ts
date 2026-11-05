import assert from "node:assert/strict";
import test from "node:test";
import { createWithRaceRecovery, isGearCreateRace, safeWriteFailureReason } from "./writeRecovery";

function prismaError(code: string, meta?: unknown, message = "Invalid `prisma.gearItem.create()` invocation: secret-looking text") {
    const error = new Error(message);
    error.name = "PrismaClientKnownRequestError";
    Object.assign(error, { code, meta });
    return error;
}

const RACE = () => prismaError("P2002", { target: ["name", "brand_id"] });

test("safeWriteFailureReason returns fixed reasons and never the raw message", () => {
    assert.equal(safeWriteFailureReason(prismaError("P2002")), "conflicting concurrent write");
    assert.equal(safeWriteFailureReason(prismaError("P2003")), "brand reference rejected by database");
    assert.equal(safeWriteFailureReason(prismaError("P2025")), "record no longer exists");
    assert.equal(safeWriteFailureReason(prismaError("P2011")), "database error (P2011)");
    assert.equal(safeWriteFailureReason(new Error("postgresql://user:pw@host/db failed")), "unexpected error");
    assert.equal(safeWriteFailureReason("string"), "unexpected error");
    assert.equal(safeWriteFailureReason(null), "unexpected error");

    for (const error of [prismaError("P2002"), prismaError("P2003"), prismaError("P2011"), new Error("x")]) {
        assert.doesNotMatch(safeWriteFailureReason(error), /secret|postgresql|invocation/i);
    }
});

test("a forged error code cannot inject text into the reason", () => {
    assert.equal(safeWriteFailureReason(prismaError("P2002; DROP TABLE")), "unexpected error");
});

test("isGearCreateRace accepts only a P2002 on the (name, brand) key", () => {
    assert.equal(isGearCreateRace(prismaError("P2002", { target: ["name", "brand_id"] })), true);
    assert.equal(isGearCreateRace(prismaError("P2002", { target: ["name", "brandId"] })), true);
    assert.equal(isGearCreateRace(prismaError("P2002", { target: "gear_items_name_brand_id_key" })), true);
    assert.equal(isGearCreateRace(prismaError("P2002")), true, "no target: the re-read does the verifying");

    assert.equal(isGearCreateRace(prismaError("P2002", { target: ["gear_item_id", "label", "gender"] })), false, "variant uniqueness");
    assert.equal(isGearCreateRace(prismaError("P2002", { target: "brands_name_key" })), false);
    assert.equal(isGearCreateRace(prismaError("P2002", { target: 5 })), false);
    assert.equal(isGearCreateRace(prismaError("P2003", { target: ["name", "brand_id"] })), false);
    assert.equal(isGearCreateRace(new Error("Unique constraint failed")), false);
    assert.equal(isGearCreateRace(undefined), false);
});

test("a successful create is returned as inserted and nothing is re-read", async () => {
    const calls: string[] = [];
    const result = await createWithRaceRecovery({
        create: async () => (calls.push("create"), "created"),
        findExisting: async () => (calls.push("find"), null),
        update: async () => (calls.push("update"), "updated"),
    });
    assert.deepEqual(result, { action: "inserted", item: "created" });
    assert.deepEqual(calls, ["create"]);
});

test("a verified race re-reads the current row, then updates it exactly once", async () => {
    const calls: string[] = [];
    const result = await createWithRaceRecovery({
        create: async () => (calls.push("create"), Promise.reject(RACE())),
        findExisting: async () => (calls.push("find"), { id: "item-1" }),
        update: async (id) => (calls.push(`update:${id}`), "updated"),
    });
    assert.deepEqual(result, { action: "updated", item: "updated" });
    assert.deepEqual(calls, ["create", "find", "update:item-1"]);
});

test("a P2002 that is not on the item key is never retried", async () => {
    const calls: string[] = [];
    const variantConflict = prismaError("P2002", { target: ["gear_item_id", "label", "gender"] });
    await assert.rejects(
        createWithRaceRecovery({
            create: async () => (calls.push("create"), Promise.reject(variantConflict)),
            findExisting: async () => (calls.push("find"), { id: "item-1" }),
            update: async () => (calls.push("update"), "updated"),
        }),
        (error) => error === variantConflict,
    );
    assert.deepEqual(calls, ["create"]);
});

test("a P2002 whose row cannot be re-read is not treated as a race", async () => {
    const calls: string[] = [];
    const conflict = RACE();
    await assert.rejects(
        createWithRaceRecovery({
            create: async () => (calls.push("create"), Promise.reject(conflict)),
            findExisting: async () => (calls.push("find"), null),
            update: async () => (calls.push("update"), "updated"),
        }),
        (error) => error === conflict,
    );
    assert.deepEqual(calls, ["create", "find"]);
});

test("other errors are rethrown untouched without a re-read", async () => {
    const calls: string[] = [];
    const failure = prismaError("P2003");
    await assert.rejects(
        createWithRaceRecovery({
            create: async () => (calls.push("create"), Promise.reject(failure)),
            findExisting: async () => (calls.push("find"), { id: "x" }),
            update: async () => (calls.push("update"), "updated"),
        }),
        (error) => error === failure,
    );
    assert.deepEqual(calls, ["create"]);
});

test("the recovery update is bounded: if it fails, the error propagates and nothing retries again", async () => {
    let updates = 0;
    const second = prismaError("P2002", { target: ["gear_item_id", "label", "gender"] });
    await assert.rejects(
        createWithRaceRecovery({
            create: async () => Promise.reject(RACE()),
            findExisting: async () => ({ id: "item-1" }),
            update: async () => {
                updates += 1;
                throw second;
            },
        }),
        (error) => error === second,
    );
    assert.equal(updates, 1);
});
