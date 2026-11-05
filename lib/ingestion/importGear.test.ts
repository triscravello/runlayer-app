import assert from "node:assert/strict";
import test from "node:test";
import type { GearWriteInput } from "@/services/gearService";
import { BRAND_FAILURE, planBrandResolution, type BrandRecord, type BrandReference, type ResolvedBrandOutcome } from "./brandResolution";
import { importGear, type ImportGearDeps } from "./importGear";
import { mapBrandReference, mapGearItem } from "./mappers/gearMapper";
import type { RawGearItemInput } from "./types";
import { validateGearItem } from "./validators/gearValidator";

const NIKE: BrandRecord = { id: "11111111-1111-4111-8111-111111111111", name: "Nike" };

const row = (overrides: Record<string, unknown> = {}) => ({ name: "Run Top", brand: "nike", category: "top", price: 100, ...overrides });

// --- mapper -------------------------------------------------------------------------------------------------------

test("the mapper records a brand reference and never a brandId", () => {
    const mapped = mapGearItem(row({ tags: [" Warm ", "warm", ""] }) as unknown as RawGearItemInput);

    assert.deepEqual(mapped.brandRef, { id: null, name: "nike" });
    assert.equal("brandId" in mapped, false, "no brand name is smuggled into a database-id field");
    assert.equal("slug" in mapped, false);
    assert.equal(mapped.category, "TOP");
    assert.equal(mapped.priceRange, "MID", "pricing behavior is unchanged");
    assert.deepEqual(mapped.tags, ["warm"]);
});

test("mapBrandReference keeps both id and name and treats blanks as absent", () => {
    assert.deepEqual(mapBrandReference({ brandId: " abc ", brand: " Nike " }), { id: "abc", name: "Nike" });
    assert.deepEqual(mapBrandReference({ brandId: "  ", brand: "Nike" }), { id: null, name: "Nike" });
    assert.deepEqual(mapBrandReference({}), { id: null, name: null });
});

// --- validator ----------------------------------------------------------------------------------------------------

test("a well-formed catalog row validates", () => {
    assert.deepEqual(validateGearItem(row()), []);
    assert.deepEqual(validateGearItem(row({ brand: undefined, brandId: NIKE.id })), []);
});

test("malformed rows produce row-level errors and never throw", () => {
    const malformed: unknown[] = [
        null,
        undefined,
        42,
        "text",
        [],
        {},
        row({ name: 5 }),
        row({ brand: 123 }),
        row({ brand: {} }),
        row({ brandId: [] , brand: undefined }),
        row({ brand: "bad\u0000" }),
        row({ brand: "x".repeat(1000) }),
        row({ brand: undefined }),
        row({ brand: "   ", brandId: "" }),
        row({ category: 7 }),
        row({ category: "SHOES" }),
        row({ priceRange: 5, price: undefined }),
        row({ priceRange: "LUXURY", price: undefined }),
        row({ tags: "warm" }),
        row({ imageUrl: 5 }),
    ];

    for (const item of malformed) {
        const errors = validateGearItem(item);
        assert.ok(errors.length > 0, `rejects ${JSON.stringify(item)?.slice(0, 60)}`);
    }
});

test("validator messages never echo the offending value", () => {
    const secret = "SUPER-SECRET-VALUE";
    const errors = validateGearItem(row({ brand: `${secret}\u0000`, category: secret, priceRange: secret }));
    assert.ok(errors.length >= 3);
    assert.doesNotMatch(errors.join("|"), new RegExp(secret));
});

// --- orchestration ------------------------------------------------------------------------------------------------

function createDeps(items: unknown[], brands: BrandRecord[] = []) {
    const created: string[] = [];
    const written: GearWriteInput[][] = [];
    const resolved: BrandReference[][] = [];
    let nextId = 1;

    const deps: ImportGearDeps = {
        parseItems: async () => items,
        resolveBrands: async (references) => {
            resolved.push(references);
            const plan = planBrandResolution(brands, references, "create-missing");
            const current = [...brands];
            for (const name of plan.toCreate) {
                created.push(name);
                current.push({ id: `22222222-2222-4222-8222-${String(nextId++).padStart(12, "0")}`, name });
            }
            return planBrandResolution(current, references, "require-existing").outcomes as ResolvedBrandOutcome[];
        },
        bulkUpsert: async (batch) => {
            written.push(batch);
            return { inserted: batch.length, updated: 0, failed: [] };
        },
    };

    return { deps, created, written, resolved };
}

test("import into an empty database creates brands and writes only real brand ids", async () => {
    const { deps, created, written } = createDeps([row(), row({ name: "Run Short", brand: "brooks", category: "bottom" }), row({ name: "Run Cap", category: "accessory" })]);
    const result = await importGear(deps);

    assert.deepEqual(created, ["brooks", "nike"], "each brand once, sorted");
    assert.equal(result.processed, 3);
    assert.equal(result.inserted, 3);
    assert.deepEqual(result.failed, []);

    for (const item of written[0]) {
        assert.match(item.brandId, /^22222222-/);
        assert.notEqual(item.brandId, "nike");
        assert.notEqual(item.brandId, "brooks");
        assert.equal("brandRef" in item, false);
    }
    assert.equal(written[0][0].brandId, written[0][2].brandId, "rows sharing a brand share its id");
});

test("import with an existing brand reuses its id and creates nothing", async () => {
    const { deps, created, written } = createDeps([row()], [NIKE]);
    await importGear(deps);

    assert.deepEqual(created, []);
    assert.equal(written[0][0].brandId, NIKE.id);
});

test("an invalid explicit brandId and a conflicting id/name fail their rows; other rows still import", async () => {
    const items = [
        row({ name: "Good", brand: "Nike" }),
        row({ name: "Bad Id", brand: undefined, brandId: "nike" }),
        row({ name: "Conflict", brand: "Brooks", brandId: NIKE.id }),
        row({ name: "Malformed", brand: 5 }),
        null,
    ];
    const { deps, written, created } = createDeps(items, [NIKE]);
    const result = await importGear(deps);

    assert.equal(result.processed, 5);
    assert.equal(written[0].length, 1);
    assert.equal(written[0][0].name, "Good");
    assert.deepEqual(created, [], "a rejected row never creates its brand");
    assert.deepEqual(
        result.failed.map((failure) => [failure.name, failure.reason]),
        [
            ["Malformed", BRAND_FAILURE.invalidName],
            ["unknown", "item must be an object"],
            ["Bad Id", BRAND_FAILURE.unknownId],
            ["Conflict", BRAND_FAILURE.conflict],
        ],
    );
});

test("ambiguous existing brands fail the row with a fixed reason", async () => {
    const twin: BrandRecord = { id: "33333333-3333-4333-8333-333333333333", name: "NIKE" };
    const { deps } = createDeps([row()], [NIKE, twin]);
    const result = await importGear(deps);

    assert.deepEqual(result.failed, [{ name: "Run Top", reason: BRAND_FAILURE.ambiguous }]);
    assert.equal(result.inserted, 0);
});

test("partial write failures are merged into the result without losing the successes", async () => {
    const { deps } = createDeps([row(), row({ name: "Other" })], [NIKE]);
    deps.bulkUpsert = async () => ({ inserted: 1, updated: 0, failed: [{ name: "Other", reason: "conflicting concurrent write" }] });
    const result = await importGear(deps);

    assert.equal(result.processed, 2);
    assert.equal(result.inserted, 1);
    assert.deepEqual(result.failed, [{ name: "Other", reason: "conflicting concurrent write" }]);
});

test("nothing is written when no row is writable", async () => {
    const { deps, written } = createDeps([{}, row({ brand: undefined })]);
    const result = await importGear(deps);

    assert.equal(written.length, 0);
    assert.equal(result.inserted, 0);
    assert.equal(result.failed.length, 2);
});

test("failure labels are bounded and stripped of control characters", async () => {
    const { deps } = createDeps([{ name: `bad\u0000${"n".repeat(500)}`, brand: 5, category: "top", price: 1 }]);
    const [failure] = (await importGear(deps)).failed;

    assert.ok(failure.name.length <= 80);
    assert.doesNotMatch(failure.name, /\u0000/);
});

test("a resolver that returns the wrong number of outcomes aborts instead of misattributing brands", async () => {
    const { deps } = createDeps([row()]);
    deps.resolveBrands = async () => [];
    await assert.rejects(importGear(deps), /unexpected number of results/);
});

test("the same input yields the same result regardless of row order", async () => {
    const items = [row({ name: "A", brand: "zed" }), row({ name: "B", brand: "alpha" }), row({ name: "C", brand: "Alpha" })];
    const forward = createDeps(items);
    const reverse = createDeps([...items].reverse());
    await importGear(forward.deps);
    await importGear(reverse.deps);

    assert.deepEqual(forward.created, reverse.created);
});
