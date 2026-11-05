import assert from "node:assert/strict";
import test from "node:test";
import { isBrandUniqueConflict } from "./brandErrors";
import { createBrand, InvalidBrandNameError, type BrandWriter } from "./brandRepository";

type Row = { id: string; name: string; normalizedName: string; tier: string | null; style: string | null; createdAt: Date; updatedAt: Date };
type UpsertArgs = {
    where: { normalizedName: string };
    update: { tier?: string; style?: string };
    create: { name: string; normalizedName: string; tier: string | null; style: string | null };
    select: Record<string, boolean>;
};

function prismaError(code: string, meta?: unknown) {
    const error = new Error("Invalid `prisma.brand.upsert()` invocation: do-not-leak");
    error.name = "PrismaClientKnownRequestError";
    Object.assign(error, { code, meta });
    return error;
}

/**
 * In-memory stand-in for the brands table with the two unique keys. `upsert` is atomic per key like the real database;
 * `failures` makes the next calls throw first, to exercise the race-recovery path.
 */
function createFakeWriter(initial: Array<Partial<Row> & { id: string; name: string; normalizedName: string }> = [], failures: unknown[] = []) {
    const rows = new Map<string, Row>();
    for (const row of initial) rows.set(row.normalizedName, { tier: null, style: null, createdAt: new Date(0), updatedAt: new Date(0), ...row });
    const calls: UpsertArgs[] = [];
    let nextId = 1;

    const client = {
        brand: {
            upsert: async (args: UpsertArgs) => {
                calls.push(args);
                const failure = failures.shift();
                if (failure) throw failure;

                const existing = rows.get(args.where.normalizedName);
                if (existing) {
                    if (args.update.tier !== undefined) existing.tier = args.update.tier;
                    if (args.update.style !== undefined) existing.style = args.update.style;
                    return project(existing, args.select);
                }

                const created: Row = { id: `new-${nextId++}`, ...args.create, createdAt: new Date(0), updatedAt: new Date(0) };
                rows.set(created.normalizedName, created);
                return project(created, args.select);
            },
        },
    } as unknown as BrandWriter;

    return { client, calls, rows };
}

const project = (row: Row, select: Record<string, boolean>) => Object.fromEntries(Object.entries(row).filter(([key]) => select[key]));

test("createBrand stores the display name and the key from the shared identity function", async () => {
    const fake = createFakeWriter();
    const created = await createBrand({ name: "  Expntl   Athletics ", tier: " premium ", style: "" }, fake.client);

    assert.deepEqual(fake.calls[0].where, { normalizedName: "expntl athletics" });
    assert.deepEqual(fake.calls[0].create, { name: "Expntl Athletics", normalizedName: "expntl athletics", tier: "premium", style: null });
    assert.equal(created.name, "Expntl Athletics");
    assert.equal(fake.rows.size, 1);
});

test("the response shape is unchanged: the internal normalized key is never selected or returned", async () => {
    const fake = createFakeWriter();
    const created = await createBrand({ name: "Nike" }, fake.client);

    assert.deepEqual(Object.keys(fake.calls[0].select).sort(), ["createdAt", "id", "name", "style", "tier", "updatedAt"]);
    assert.equal("normalizedName" in created, false);
    assert.deepEqual(Object.keys(created).sort(), ["createdAt", "id", "name", "style", "tier", "updatedAt"]);
});

test("an equivalent existing brand is returned with its id and display name untouched", async () => {
    const fake = createFakeWriter([{ id: "existing-1", name: "Nike", normalizedName: "nike", tier: "performance" }]);

    for (const requested of ["nike", "NIKE", "  Nike ", "ＮＩＫＥ"]) {
        const result = await createBrand({ name: requested }, fake.client);
        assert.equal(result.id, "existing-1", requested);
        assert.equal(result.name, "Nike", `${requested}: the display name is not rewritten`);
    }

    assert.equal(fake.rows.size, 1, "no twin was created");
    for (const call of fake.calls) {
        assert.equal("name" in call.update, false, "the update never carries a name");
        assert.equal("normalizedName" in call.update, false, "...or a key");
    }
});

test("tier and style are updated only when supplied, as before", async () => {
    const fake = createFakeWriter([{ id: "b1", name: "Nike", normalizedName: "nike", tier: "performance", style: "road" }]);

    await createBrand({ name: "nike" }, fake.client);
    assert.deepEqual([fake.rows.get("nike")?.tier, fake.rows.get("nike")?.style], ["performance", "road"], "nothing supplied, nothing changed");

    await createBrand({ name: "nike", tier: " premium " }, fake.client);
    assert.deepEqual([fake.rows.get("nike")?.tier, fake.rows.get("nike")?.style], ["premium", "road"]);

    await createBrand({ name: "nike", tier: "   ", style: "trail" }, fake.client);
    assert.deepEqual([fake.rows.get("nike")?.tier, fake.rows.get("nike")?.style], ["premium", "trail"], "a blank value is 'not supplied'");
});

test("many equivalent creators at once end with exactly one brand, and every caller gets its id", async () => {
    const fake = createFakeWriter();
    const results = await Promise.all(["nike", "NIKE", " Nike ", "NiKe", "nike  ", "ＮＩＫＥ", "Nike", "nIKE"].map((name) => createBrand({ name }, fake.client)));

    assert.equal(fake.rows.size, 1);
    assert.equal(new Set(results.map((row) => row.id)).size, 1);
});

test("a lost creation race is retried exactly once and returns the winner's row", async () => {
    for (const target of [["normalized_name"], ["name"], ["normalizedName"], "brands_normalized_name_key", "brands_name_key"]) {
        const winner = { id: "winner", name: "Nike", normalizedName: "nike" };
        const fake = createFakeWriter([winner], [prismaError("P2002", { target })]);
        const result = await createBrand({ name: "nike" }, fake.client);

        assert.equal(result.id, "winner", JSON.stringify(target));
        assert.equal(fake.calls.length, 2, "one failure plus one retry");
    }
});

test("the retry is bounded: a second conflict is reported, not retried again", async () => {
    const conflict = () => prismaError("P2002", { target: ["normalized_name"] });
    const second = conflict();
    const fake = createFakeWriter([], [conflict(), second]);

    await assert.rejects(createBrand({ name: "nike" }, fake.client), (error: unknown) => error === second);
    assert.equal(fake.calls.length, 2);
});

test("other failures are never retried or converted", async () => {
    for (const failure of [prismaError("P2002", { target: ["email"] }), prismaError("P2002"), prismaError("P2003"), new Error("boom")]) {
        const fake = createFakeWriter([], [failure]);
        await assert.rejects(createBrand({ name: "nike" }, fake.client), (error: unknown) => error === failure);
        assert.equal(fake.calls.length, 1);
    }
});

test("names that cannot be brands never reach the database", async () => {
    const fake = createFakeWriter();

    for (const bad of ["", "   ", "x".repeat(101), "a\u0000b", "a\tb", "ﷺ".repeat(6)]) {
        await assert.rejects(createBrand({ name: bad }, fake.client), (error: unknown) => error instanceof InvalidBrandNameError, JSON.stringify(bad));
    }
    assert.equal(fake.calls.length, 0);
});

test("isBrandUniqueConflict recognizes only a unique violation on a brand key", () => {
    assert.equal(isBrandUniqueConflict(prismaError("P2002", { target: ["normalized_name"] })), true);
    assert.equal(isBrandUniqueConflict(prismaError("P2002", { target: ["name"] })), true);
    assert.equal(isBrandUniqueConflict(prismaError("P2002", { target: "brands_normalized_name_key" })), true);

    for (const other of [
        prismaError("P2002", { target: ["name", "brand_id"] }),
        prismaError("P2002", { target: ["email"] }),
        prismaError("P2002", { target: [] }),
        prismaError("P2002", { target: 5 }),
        prismaError("P2002"),
        prismaError("P2003", { target: ["name"] }),
        new Error("P2002"),
        null,
        "P2002",
    ]) {
        assert.equal(isBrandUniqueConflict(other), false);
    }
});
