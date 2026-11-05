import assert from "node:assert/strict";
import test from "node:test";
import { BRAND_RESOLUTION_LOCK_NAME, resolveImportBrands, type BrandTransactionRunner } from "./brandStore";

type Row = { id: string; name: string };

// In-memory stand-in for the transaction client. It records the order of operations so the tests can prove the
// lock is taken first, creation is sorted, and everything runs inside one transaction.
function createFake(initial: Row[]) {
    const brands = [...initial];
    const log: string[] = [];
    let transactions = 0;
    let nextId = 1;

    const tx = {
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
            log.push(`lock:${strings.join("?")}:${values.join(",")}`);
            return 0;
        },
        brand: {
            findMany: async () => (log.push("findMany"), brands.map((brand) => ({ ...brand }))),
            upsert: async (args: { where: { name: string }; create: { name: string } }) => {
                log.push(`upsert:${args.where.name}`);
                const found = brands.find((brand) => brand.name === args.where.name);
                if (found) return found;
                const created = { id: `new-${nextId++}`, name: args.create.name };
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

    return { client, log, brands, transactionCount: () => transactions };
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
