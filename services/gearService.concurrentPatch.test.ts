import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { barrier, createGearStore, deferred, makeRow } from "../test-support/gearStoreFake";

// Concurrent PATCH integrity, Stage 1: sparse writes. Every test drives the REAL service and repository against a stateful
// in-memory Prisma fake. A barrier on the lookup forces the worst interleaving: both requests have READ the item before either
// WRITES, which is exactly when a write rebuilt from the stored row would overwrite the other request's change with stale data.
const LEGACY_LINK = "javascript:legacy";
let store = createGearStore([]);
(globalThis as unknown as { prisma: unknown }).prisma = { gearItem: new Proxy({}, { get: (_target, key) => (store.gearItem as Record<string, unknown>)[key as string] }) };

const fresh = (extra: Record<string, unknown> = {}) => { store = createGearStore([makeRow({ id: "g1", ...extra })]); };
beforeEach(() => fresh());

async function service() {
    return import("./gearService");
}

/** Runs two updates that have both read the item before either writes; `first` is applied to the store before `second`. */
async function raceBoth(first: () => Promise<unknown>, second: () => Promise<unknown>, isFirst: (data: Record<string, unknown>) => boolean) {
    store.hooks.afterLookup = barrier(2);
    const gates = { first: deferred(), second: deferred() };
    store.hooks.beforeUpdate = async ({ data }) => { await (isFirst(data) ? gates.first : gates.second).promise; };
    const a = first();
    const b = second();
    await Promise.resolve();
    // Both requests are parked on the barrier or the gates; release in the requested order.
    gates.first.resolve();
    await a;
    gates.second.resolve();
    return Promise.all([a, b]);
}

test("1. two PATCHes of different scalar fields both persist, in either order", async () => {
    const { updateGearItem } = await service();
    for (const order of ["name-first", "tags-first"] as const) {
        fresh();
        const rename = () => updateGearItem("g1", { name: "Renamed" });
        const retag = () => updateGearItem("g1", { tags: ["Trail", "trail", "rain"] });
        if (order === "name-first") await raceBoth(rename, retag, (data) => "name" in data);
        else await raceBoth(retag, rename, (data) => "tags" in data);
        const row = store.get("g1")!;
        assert.equal(row.name, "Renamed", order);
        assert.deepEqual(row.tags, ["trail", "rain"], order);
        assert.equal(row.genderTarget, "men", "untouched columns keep their value");
        assert.deepEqual(store.writes.map((write) => Object.keys(write.data!)), order === "name-first" ? [["name"], ["tags"]] : [["tags"], ["name"]]);
    }
});

test("2/3. a variants update and a scalar update both persist, in either operation order", async () => {
    const { updateGearItem } = await service();
    const newVariants = [{ label: "Men", gender: "men" }, { label: "Women", gender: "women", sizes: ["S"] }];
    for (const order of ["variants-first", "scalar-first"] as const) {
        fresh();
        const setVariants = () => updateGearItem("g1", { variants: newVariants });
        const setPrice = () => updateGearItem("g1", { priceRange: "PREMIUM", subcategory: "  Long Sleeve " });
        if (order === "variants-first") await raceBoth(setVariants, setPrice, (data) => "variants" in data);
        else await raceBoth(setPrice, setVariants, (data) => "priceRange" in data);
        const row = store.get("g1")!;
        assert.deepEqual(row.variants.map((variant) => variant.label), ["Men", "Women"], order);
        assert.equal(row.priceRange, "PREMIUM", order);
        assert.equal(row.subcategory, "Long Sleeve", order);
    }
});

test("2b. a scalar-only update never replaces variants or their ids, even while variants are being replaced elsewhere", async () => {
    const { updateGearItem } = await service();
    const before = store.get("g1")!.variants.map((variant) => variant.id);
    await updateGearItem("g1", { name: "Renamed" });
    assert.deepEqual(store.get("g1")!.variants.map((variant) => variant.id), before);
    assert.equal("variants" in store.writes[0].data!, false);
});

test("4. two updates of the same field stay last-write-wins", async () => {
    const { updateGearItem } = await service();
    for (const order of ["A-then-B", "B-then-A"] as const) {
        fresh();
        const a = () => updateGearItem("g1", { name: "From A" });
        const b = () => updateGearItem("g1", { name: "From B" });
        // Both requests carry the same key, so the gate is chosen by call order instead.
        store.hooks.afterLookup = barrier(2);
        const gates = [deferred(), deferred()];
        let arrival = 0;
        store.hooks.beforeUpdate = async () => { await gates[arrival++].promise; };
        const pa = a();
        const pb = b();
        await Promise.resolve();
        gates[0].resolve();
        await new Promise((resolve) => setImmediate(resolve));
        gates[1].resolve();
        await Promise.all([pa, pb]);
        // Whichever request reached its write last wins; the point is that the outcome is one of the two submitted values.
        assert.match(store.get("g1")!.name, /^From [AB]$/, order);
        assert.equal(store.writes.length, 2);
        assert.equal(store.get("g1")!.name, store.writes[1].data!.name, "the later write is the stored value");
    }
});

test("5a. delete applied between an update's lookup and its write: the update fails with P2025 and writes nothing", async () => {
    const { updateGearItem } = await service();
    const looked = deferred();
    store.hooks.afterLookup = () => looked.resolve();
    const release = deferred();
    store.hooks.beforeUpdate = async () => { await release.promise; };
    const pending = updateGearItem("g1", { name: "Too late" });
    const outcome = pending.then(() => "ok", (error: { code?: string }) => error.code);
    await looked.promise;
    await store.gearItem.delete({ where: { id: "g1" } });
    release.resolve();
    assert.equal(await outcome, "P2025");
    assert.deepEqual(store.writes.map((write) => write.op), ["delete"], "the failed update recorded no write");
    assert.equal(store.get("g1"), undefined);
});

test("5b. update that lands before a delete is simply followed by the delete; a lookup after the delete is a typed not-found", async () => {
    const { updateGearItem } = await service();
    const { GearItemNotFoundError } = await import("../lib/gear/inputErrors");
    await updateGearItem("g1", { name: "Renamed" });
    await store.gearItem.delete({ where: { id: "g1" } });
    await assert.rejects(updateGearItem("g1", { name: "Again" }), GearItemNotFoundError);
    assert.deepEqual(store.writes.map((write) => write.op), ["update", "delete"]);
});

test("6. omitted, explicit undefined and explicit null are three different things", async () => {
    const { updateGearItem } = await service();
    await updateGearItem("g1", { name: "Renamed", imageUrl: undefined, genderTarget: undefined, tags: undefined });
    assert.deepEqual(Object.keys(store.writes[0].data!), ["name"], "explicit undefined is not written");
    assert.equal(store.get("g1")!.imageUrl, "https://e.test/i.png");

    await updateGearItem("g1", { imageUrl: null, genderTarget: null, subcategory: "  ", affiliateUrl: null });
    const row = store.get("g1")!;
    assert.equal(row.imageUrl, null);
    assert.equal(row.genderTarget, null);
    assert.equal(row.subcategory, null, "a blank string clears, as in the full-record normalizer");
    assert.equal(row.affiliateUrl, null);
    assert.deepEqual(row.tags, ["light"], "arrays that were not supplied are kept");
    assert.deepEqual(row.bodyTypeFit, ["slim"]);
});

test("6b. a supplied array replaces the stored array as a whole; [] clears it", async () => {
    const { updateGearItem } = await service();
    await updateGearItem("g1", { tags: ["a", "b"], bodyTypeFit: [] });
    assert.deepEqual(store.get("g1")!.tags, ["a", "b"]);
    assert.deepEqual(store.get("g1")!.bodyTypeFit, []);
});

test("6c. weatherSuitability: only supplied scores are written, and hot: null keeps its existing meaning (no write to weatherHot)", async () => {
    const { updateGearItem } = await service();
    await updateGearItem("g1", { weatherSuitability: { cold: 0.9 } });
    assert.deepEqual(store.get("g1")!.weatherCold, 0.9);
    assert.equal(store.get("g1")!.weatherHot, 0.4);
    await updateGearItem("g1", { weatherSuitability: { hot: null } });
    assert.equal(store.get("g1")!.weatherHot, 0.4, "unchanged behavior: an explicit hot null does not clear the column (Patch B, not this stage)");
});

test("7. variants: [] still synthesizes a Default from the item's links: supplied ones first, then stored, never an unsafe stored link", async () => {
    const { updateGearItem } = await service();
    await updateGearItem("g1", { variants: [] });
    let variants = store.get("g1")!.variants;
    assert.equal(variants.length, 1);
    assert.deepEqual([variants[0].label, variants[0].gender, variants[0].affiliateUrl, variants[0].imageUrl], ["Default", "unisex", "https://e.test/a", "https://e.test/i.png"]);

    await updateGearItem("g1", { variants: [], affiliateUrl: "https://e.test/new", imageUrl: null });
    variants = store.get("g1")!.variants;
    assert.deepEqual([variants[0].affiliateUrl, variants[0].imageUrl], ["https://e.test/new", null], "links supplied in the same request win");

    fresh({ affiliateUrl: LEGACY_LINK });
    await updateGearItem("g1", { variants: [] });
    assert.equal(store.get("g1")!.variants[0].affiliateUrl, null, "an unsafe stored link is not copied into the new row");
    assert.equal(store.get("g1")!.affiliateUrl, LEGACY_LINK, "and the stored item link itself is left alone");
});

test("7b. variants: [] and a concurrent scalar update both persist", async () => {
    const { updateGearItem } = await service();
    await raceBoth(() => updateGearItem("g1", { variants: [] }), () => updateGearItem("g1", { name: "Renamed" }), (data) => "variants" in data);
    assert.equal(store.get("g1")!.name, "Renamed");
    assert.deepEqual(store.get("g1")!.variants.map((variant) => variant.label), ["Default"]);
});

test("8. invalid input produces zero writes (and no lookup-dependent side effects)", async () => {
    const { updateGearItem } = await service();
    const bad: Array<Record<string, unknown>> = [
        { tags: null },
        { tags: [1] },
        { variants: null },
        { variants: {} },
        { variants: ["x"] },
        { variants: [{ label: "a", gender: "men", affiliateUrl: "javascript:alert(1)" }] },
        { variants: [{ label: "a", gender: "men", gearItem: { connect: { id: "z" } } }] },
        { category: "SHOES" },
        { priceRange: "FREE" },
        { weatherSuitability: { sunny: 1 } },
        { weatherSuitability: { rain: Number.NaN } },
        { name: 5 },
        { genderTarget: 7 },
    ];
    for (const input of bad) await assert.rejects(updateGearItem("g1", input as never), () => true, JSON.stringify(input));
    assert.equal(store.writes.length, 0);
    assert.equal(store.calls.includes("update"), false);
    assert.deepEqual(store.get("g1"), makeRow({ id: "g1" }));
});

test("9. legacy invalid affiliate URLs never block unrelated edits, and are not rewritten", async () => {
    const { updateGearItem } = await service();
    fresh({ affiliateUrl: LEGACY_LINK, variants: [{ id: "v1", gearItemId: "g1", label: "Default", gender: "unisex", affiliateUrl: "data:text/html,x", imageUrl: null, price: null, sizes: [] }] });
    await raceBoth(() => updateGearItem("g1", { name: "Renamed" }), () => updateGearItem("g1", { tags: ["x"] }), (data) => "name" in data);
    const row = store.get("g1")!;
    assert.equal(row.name, "Renamed");
    assert.deepEqual(row.tags, ["x"]);
    assert.equal(row.affiliateUrl, LEGACY_LINK);
    assert.equal(row.variants[0].affiliateUrl, "data:text/html,x");
    // An unsafe link that IS supplied in the request is still refused.
    await assert.rejects(updateGearItem("g1", { variants: [{ label: "a", gender: "men", affiliateUrl: "javascript:x" }] }));
});

test("targeted lookup: the update path never lists the catalog and selects only what it needs", async () => {
    const { updateGearItem } = await service();
    await updateGearItem("g1", { name: "Renamed" });
    assert.deepEqual(store.calls, ["findUnique", "update"]);
});

test("10. importer upsert still writes the complete record it supplies, defaults included, and replaces variants", async () => {
    const { upsertGearItem, bulkUpsertGearItems } = await service();
    // The record is shaped by the same schema the import route applies, so create-time defaults (imageUrl: null, ...) are present.
    const { importGearItemsSchema } = await import("../lib/validation/adminGear");
    const [full] = importGearItemsSchema.parse([{ name: "Item g1", brandId: "b1", category: "BOTTOM", priceRange: "BUDGET", affiliateUrl: "https://e.test/imp" }]);
    const result = await upsertGearItem(full);
    assert.equal(result.action, "updated");
    const row = store.get("g1")!;
    assert.deepEqual([row.category, row.priceRange, row.affiliateUrl], ["BOTTOM", "BUDGET", "https://e.test/imp"]);
    assert.equal(row.genderTarget, null, "a full record that omits genderTarget clears it, as it always did");
    assert.equal(row.subcategory, null);
    assert.deepEqual(row.tags, []);
    assert.equal(row.imageUrl, null);
    assert.deepEqual(row.bodyTypeFit, [], "the import schema supplies [] for it, so a full-record import clears it, as before");
    assert.deepEqual(row.variants.map((variant) => [variant.label, variant.affiliateUrl]), [["Default", "https://e.test/imp"]]);
    assert.deepEqual(row.weatherHot, 0.4);

    const summary = await bulkUpsertGearItems([{ ...full, tags: ["Rain"], variants: [{ label: "Men", gender: "men" }] }]);
    assert.deepEqual(summary, { total: 1, inserted: 0, updated: 1, failed: [] });
    assert.deepEqual(store.get("g1")!.tags, ["rain"]);
    assert.deepEqual(store.get("g1")!.variants.map((variant) => variant.label), ["Men"]);
});

test("10b. bodyTypeFit is explicitly supplied as [] by both importers, so it is cleared exactly as before", async () => {
    const { bulkUpsertGearItems } = await service();
    const { mapGearItem } = await import("../lib/ingestion/mappers/gearMapper");
    const { validateBulkGearImportRows } = await import("../lib/validation/adminGearImport");

    // CLI importer: the mapper hard-codes bodyTypeFit: [] and the record is written as {...mapped, brandId}.
    const { brandRef, ...mapped } = mapGearItem({ name: "Item g1", brand: "Acme", category: "top", price: 80, tags: ["Rain"] } as never);
    void brandRef;
    assert.deepEqual(mapped.bodyTypeFit, []);
    assert.deepEqual(await bulkUpsertGearItems([{ ...mapped, brandId: "b1" }]), { total: 1, inserted: 0, updated: 1, failed: [] });
    assert.deepEqual(store.get("g1")!.bodyTypeFit, [], "CLI import clears bodyTypeFit");
    assert.equal(store.get("g1")!.priceRange, "MID");

    // Admin import: a row without the column is parsed to [], a row with it keeps its list.
    fresh();
    const brands = [{ id: "b1", name: "Acme" }] as never;
    const parsed = (extra: Record<string, unknown>) => validateBulkGearImportRows([{ name: "Item g1", brandId: "b1", category: "TOP", priceRange: "MID", ...extra }] as never, brands).validItems;
    const [omitted] = parsed({});
    assert.deepEqual(omitted.bodyTypeFit, [], "the column is supplied as [] even when the file omits it");
    await bulkUpsertGearItems([omitted]);
    assert.deepEqual(store.get("g1")!.bodyTypeFit, []);
    fresh();
    await bulkUpsertGearItems(parsed({ bodyTypeFit: "slim, athletic" }));
    assert.deepEqual(store.get("g1")!.bodyTypeFit, ["slim", "athletic"]);
    assert.equal(store.get("g1")!.genderTarget, null, "a full record that omits genderTarget clears it, as before");
});

test("10c. direct service callers that omit bodyTypeFit keep the stored list (as before: omitted means unchanged)", async () => {
    const { upsertGearItem } = await service();
    await upsertGearItem({ name: "Item g1", brandId: "b1", category: "TOP", priceRange: "MID", affiliateUrl: null });
    assert.deepEqual(store.get("g1")!.bodyTypeFit, ["slim"]);
});

test("11. an update with nothing recognized to write is a controlled error with zero reads and zero writes", async () => {
    const { updateGearItem } = await service();
    const { InvalidGearInputError } = await import("../lib/gear/inputErrors");
    const empty: Array<Record<string, unknown>> = [
        {}, { id: "g1" }, { externalId: "x" }, { name: undefined }, { tags: undefined, variants: undefined },
        { brand: { connect: { id: "x" } } }, { slug: "x" }, { weatherSuitability: {} }, { weatherSuitability: { hot: undefined } },
    ];
    for (const input of empty) await assert.rejects(updateGearItem("g1", input as never), InvalidGearInputError, JSON.stringify(input));
    await assert.rejects(updateGearItem("missing", {} as never), InvalidGearInputError, "validation wins over lookup: still no read");
    assert.deepEqual(store.calls, []);
    assert.equal(store.writes.length, 0);
});

test("11b. the repository refuses an empty update for direct callers too, but an explicit weather null is still a supplied value", async () => {
    const { updateGearItem } = await import("../lib/db/gearRepository");
    const { InvalidGearInputError } = await import("../lib/gear/inputErrors");
    for (const input of [{ id: "g1" }, { id: "g1", name: undefined }, { id: "g1", weatherSuitability: {} }]) {
        await assert.rejects(updateGearItem(input as never, store.gearItem as never), InvalidGearInputError, JSON.stringify(input));
    }
    assert.deepEqual(store.calls, []);
    await updateGearItem({ id: "g1", weatherSuitability: { hot: null } }, { gearItem: store.gearItem } as never);
    assert.deepEqual(store.calls, ["update"], "hot: null keeps its existing behavior (accepted, writes nothing to weatherHot)");
    assert.equal(store.get("g1")!.weatherHot, 0.4);
});
