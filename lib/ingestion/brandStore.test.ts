import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBrandKey } from "./brandResolution";
import { BRAND_RESOLUTION_LOCK_NAME, resolveImportBrands, type BrandTransactionRunner } from "./brandStore";

type Row = { id: string; name: string; normalizedName?: string };

// In-memory stand-in for the transaction client. It records the order of operations so the tests can prove the
// lock is taken first, creation is sorted, and everything runs inside one transaction.
function createFake(initial: Row[], options: { hiddenFromFirstRead?: Row[] } = {}) {
    const brands = [...initial, ...(options.hiddenFromFirstRead ?? [])];
    let firstRead = true;
    const log: string[] = [];
    let transactions = 0;
    let nextId = 1;
    const upserts: Array<{ where: { normalizedName: string }; update: unknown; create: { name: string; normalizedName: string } }> = [];

    const tx = {
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
            log.push(`lock:${strings.join("?")}:${values.join(",")}`);
            return 0;
        },
        brand: {
            // A writer that does not take the lock may add a brand after our first read (hiddenFromFirstRead).
            findMany: async () => {
                log.push("findMany");
                const hidden = firstRead ? new Set(options.hiddenFromFirstRead ?? []) : new Set<Row>();
                firstRead = false;
                return brands.filter((brand) => !hidden.has(brand)).map(({ id, name }) => ({ id, name }));
            },
            // Looked up by the unique normalized key, like the real database.
            upsert: async (args: { where: { normalizedName: string }; update: unknown; create: { name: string; normalizedName: string } }) => {
                log.push(`upsert:${args.create.name}`);
                upserts.push(args);
                const found = brands.find((brand) => (brand.normalizedName ?? normalizeBrandKey(brand.name)) === args.where.normalizedName);
                if (found) return found;
                const created = { id: `new-${nextId++}`, name: args.create.name, normalizedName: args.create.normalizedName };
                brands.push(created);
                return created;
            },
        },
    };

    const client = {
        $transaction: async (fn: (client: typeof tx) => Promise<unknown>, options?: unknown) => {
            transactions += 1;
            log.push(`tx:${JSON.stringify(options)}`);
            return fn(tx);
        },
    } as unknown as BrandTransactionRunner;

    return { client, log, brands, upserts, transactionCount: () => transactions };
}

test("brand resolution takes the advisory lock first, inside one short transaction", async () => {
    const fake = createFake([]);
    await resolveImportBrands([{ id: null, name: "nike" }], fake.client);

    assert.equal(fake.transactionCount(), 1);
    assert.match(fake.log[0], /^tx:\{"maxWait":\d+,"timeout":\d+\}$/, "bounded transaction");
    assert.match(fake.log[1], /^lock:SELECT pg_advisory_xact_lock\(hashtext\(\?\)\):/);
    assert.ok(fake.log[1].endsWith(BRAND_RESOLUTION_LOCK_NAME));
    assert.equal(fake.log[2], "findMany", "reads only after the lock is held");
});

test("empty input opens no transaction", async () => {
    const fake = createFake([]);
    assert.deepEqual(await resolveImportBrands([], fake.client), []);
    assert.equal(fake.transactionCount(), 0);
});

test("missing brands are created once, in key order, with their supplied name, and resolved to real ids", async () => {
    const fake = createFake([{ id: "existing-nike", name: "Nike" }]);
    const outcomes = await resolveImportBrands(
        [{ id: null, name: "nike" }, { id: null, name: "Brooks" }, { id: null, name: "adidas" }, { id: null, name: "BROOKS" }],
        fake.client,
    );

    assert.deepEqual(
        fake.log.filter((entry) => entry.startsWith("upsert:")),
        ["upsert:adidas", "upsert:BROOKS"],
        "existing Nike untouched; new brands sorted by key",
    );
    assert.deepEqual(outcomes, [
        { status: "resolved", brandId: "existing-nike" },
        { status: "resolved", brandId: "new-2" },
        { status: "resolved", brandId: "new-1" },
        { status: "resolved", brandId: "new-2" },
    ]);
    assert.equal(fake.brands.length, 3, "no duplicate brands");
});

test("a repeated run creates nothing", async () => {
    const fake = createFake([]);
    const refs = [{ id: null, name: "nike" }];
    const first = await resolveImportBrands(refs, fake.client);
    const second = await resolveImportBrands(refs, fake.client);

    assert.deepEqual(first, second);
    assert.equal(fake.log.filter((entry) => entry.startsWith("upsert:")).length, 1);
});

test("invalid, unknown and conflicting references fail without creating brands", async () => {
    const fake = createFake([{ id: "existing-nike", name: "Nike" }]);
    const outcomes = await resolveImportBrands(
        [{ id: "nope", name: null }, { id: "existing-nike", name: "Brooks" }, { id: null, name: "bad\u0000name" }],
        fake.client,
    );

    assert.deepEqual(outcomes.map((outcome) => outcome.status), ["failed", "failed", "failed"]);
    assert.equal(fake.log.filter((entry) => entry.startsWith("upsert:")).length, 0);
    assert.equal(fake.brands.length, 1);
});

test("an existing differently-cased brand is reused instead of creating a twin", async () => {
    // e.g. a brand written earlier by a non-participating writer: "adidas" must match "ADIDAS", not duplicate it.
    const fake = createFake([{ id: "a", name: "ADIDAS" }]);
    const outcomes = await resolveImportBrands([{ id: null, name: "adidas" }], fake.client);
    assert.deepEqual(outcomes, [{ status: "resolved", brandId: "a" }]);
    assert.equal(fake.brands.length, 1);
});

test("every created brand is stored with the key from the shared function, and creation never rewrites a display name", async () => {
    const fake = createFake([]);
    await resolveImportBrands([{ id: null, name: "  Expntl   Athletics " }, { id: null, name: "ＮＩＫＥ" }, { id: null, name: "adidas" }], fake.client);

    assert.deepEqual(
        fake.upserts.map((call) => [call.where.normalizedName, call.create.name, call.create.normalizedName, JSON.stringify(call.update)]),
        [
            ["adidas", "adidas", "adidas", "{}"],
            ["expntl athletics", "Expntl Athletics", "expntl athletics", "{}"],
            ["nike", "ＮＩＫＥ", "nike", "{}"],
        ],
        "lookup key equals the stored key; display name is the cleaned input; update is empty",
    );
});

test("a brand created by a writer that does not hold the lock is reused, not duplicated, and keeps its display name", async () => {
    // The admin API (or another importer) creates "Nike" after our first read but before our upsert.
    const concurrent: Row = { id: "concurrent-1", name: "Nike", normalizedName: "nike" };
    const fake = createFake([], { hiddenFromFirstRead: [concurrent] });
    const outcomes = await resolveImportBrands([{ id: null, name: "NIKE" }, { id: null, name: "nike" }], fake.client);

    assert.deepEqual(outcomes, [
        { status: "resolved", brandId: "concurrent-1" },
        { status: "resolved", brandId: "concurrent-1" },
    ]);
    assert.equal(fake.brands.length, 1, "exactly one brand row");
    assert.equal(fake.brands[0].name, "Nike", "the existing display name is untouched");
    assert.equal(fake.upserts.length, 1, "one equivalent-name group means one upsert");
});

test("an unstorable name is reported as failed and writes nothing", async () => {
    const fake = createFake([]);
    const outcomes = await resolveImportBrands([{ id: null, name: "x".repeat(101) }, { id: null, name: "bad\u0000name" }], fake.client);

    assert.deepEqual(outcomes.map((outcome) => outcome.status), ["failed", "failed"]);
    assert.equal(fake.upserts.length, 0, "no brand row was written");
    assert.equal(fake.brands.length, 0);
});
