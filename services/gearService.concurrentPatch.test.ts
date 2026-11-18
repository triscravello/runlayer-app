import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createGearStore, deferred, fieldsOf, makeRow } from "../test-support/gearStoreFake";

// Concurrent PATCH integrity: sparse writes, now applied in one repository transaction. Every test drives the REAL service and
// repository against a stateful in-memory Prisma fake that MODELS (does not prove) PostgreSQL row locking: an UPDATE holds the row
// until commit, a second writer waits, then re-evaluates against the committed row. The harness below makes the interleaving
// deterministic without sleeps: transaction A is parked while it holds the row lock, the fake reports when B is actually blocked
// behind it, and only then is A released.
const LEGACY_LINK = "javascript:legacy";
let store = createGearStore([]);
(globalThis as unknown as { prisma: unknown }).prisma = new Proxy({}, { get: (_target, key) => (store as unknown as Record<string, unknown>)[key as string] });

const fresh = (extra: Record<string, unknown> = {}) => { store = createGearStore([makeRow({ id: "g1", ...extra })]); };
beforeEach(() => fresh());

async function service() {
    return import("./gearService");
}

/** A holds the row lock while B starts and is observed waiting on it; then A is released. Resolves when both have settled. */
async function raceBoth(first: () => Promise<unknown>, second: () => Promise<unknown>) {
    const held = deferred();
    const release = deferred();
    const blocked = deferred();
    let parked = false;
    store.hooks.afterLock = async () => { if (!parked) { parked = true; held.resolve(); await release.promise; } };
    store.hooks.onBlocked = () => blocked.resolve();
    const a = first().then(() => "ok", (error: unknown) => error);
    await held.promise;
    const b = second().then(() => "ok", (error: unknown) => error);
    await blocked.promise;
    assert.equal(store.state.blocked, 1, "the second writer is waiting on the first one's row lock");
    release.resolve();
    return Promise.all([a, b]);
}

test("1. two PATCHes of different scalar fields both persist, in either order", async () => {
    const { updateGearItem } = await service();
    for (const order of ["name-first", "tags-first"] as const) {
        fresh();
        const rename = () => updateGearItem("g1", { name: "Renamed" });
        const retag = () => updateGearItem("g1", { tags: ["Trail", "trail", "rain"] });
        const outcomes = order === "name-first" ? await raceBoth(rename, retag) : await raceBoth(retag, rename);
        assert.deepEqual(outcomes, ["ok", "ok"], order);
        const row = store.get("g1")!;
        assert.equal(row.name, "Renamed", order);
        assert.deepEqual(row.tags, ["trail", "rain"], order);
        assert.equal(row.genderTarget, "men", "untouched columns keep their value");
        assert.deepEqual(store.writes.map(fieldsOf), order === "name-first" ? [["name"], ["tags"]] : [["tags"], ["name"]]);
        assert.equal(row.version, 2, "each committed update incremented the version once");
    }
});

test("2/3. a variants update and a scalar update both persist, in either operation order", async () => {
    const { updateGearItem } = await service();
    const newVariants = [{ label: "Men", gender: "men" }, { label: "Women", gender: "women", sizes: ["S"] }];
    for (const order of ["variants-first", "scalar-first"] as const) {
        fresh();
        const setVariants = () => updateGearItem("g1", { variants: newVariants });
        const setPrice = () => updateGearItem("g1", { priceRange: "PREMIUM", subcategory: "  Long Sleeve " });
        const outcomes = order === "variants-first" ? await raceBoth(setVariants, setPrice) : await raceBoth(setPrice, setVariants);
        assert.deepEqual(outcomes, ["ok", "ok"], order);
        const row = store.get("g1")!;
        assert.deepEqual(row.variants.map((variant) => variant.label), ["Men", "Women"], order);
        assert.equal(row.priceRange, "PREMIUM", order);
        assert.equal(row.subcategory, "Long Sleeve", order);
    }
});

test("2b. a scalar-only update never replaces variants or their ids", async () => {
    const { updateGearItem } = await service();
    const before = store.get("g1")!.variants.map((variant) => variant.id);
    await updateGearItem("g1", { name: "Renamed" });
    assert.deepEqual(store.get("g1")!.variants.map((variant) => variant.id), before);
    assert.equal(store.writes[0].variants, undefined);
    assert.equal(store.calls.includes("variant.deleteMany"), false);
});

test("4. two updates of the same field stay last-write-wins (the later committed write is the stored value)", async () => {
    const { updateGearItem } = await service();
    const outcomes = await raceBoth(() => updateGearItem("g1", { name: "From A" }), () => updateGearItem("g1", { name: "From B" }));
    assert.deepEqual(outcomes, ["ok", "ok"]);
    assert.equal(store.get("g1")!.name, "From B", "B waited for A's lock, then wrote last");
    assert.deepEqual(store.writes.map((write) => write.data!.name), ["From A", "From B"]);
});

test("5a. update waiting behind a delete finds the item gone: typed not-found, nothing written by the update", async () => {
    const { updateGearItem } = await service();
    const { GearItemNotFoundError } = await import("../lib/gear/inputErrors");
    const held = deferred();
    const release = deferred();
    const blocked = deferred();
    store.hooks.beforeDelete = async () => { held.resolve(); await release.promise; };
    store.hooks.onBlocked = () => blocked.resolve();
    const deleting = store.gearItem.delete({ where: { id: "g1" } });
    await held.promise;
    const updating = updateGearItem("g1", { name: "Too late" }).then(() => "ok", (error: unknown) => error);
    await blocked.promise;
    release.resolve();
    await deleting;
    assert.ok((await updating) instanceof GearItemNotFoundError);
    assert.deepEqual(store.writes.map((write) => write.op), ["delete"], "the failed update left no durable write");
    assert.equal(store.get("g1"), undefined);
    assert.equal(store.state.rolledBack, 1, "the update's transaction rolled back");
});

test("5b. an update that commits first is simply followed by the delete", async () => {
    const { updateGearItem } = await service();
    const held = deferred();
    const release = deferred();
    const blocked = deferred();
    store.hooks.afterLock = async () => { held.resolve(); await release.promise; };
    store.hooks.onBlocked = () => blocked.resolve();
    const updating = updateGearItem("g1", { name: "Renamed" });
    await held.promise;
    const deleting = store.gearItem.delete({ where: { id: "g1" } });
    await blocked.promise;
    release.resolve();
    await Promise.all([updating, deleting]);
    assert.deepEqual(store.writes.map((write) => write.op), ["update", "delete"]);
    assert.equal(store.get("g1"), undefined);
});

test("5c. a missing item is a typed not-found with no durable write", async () => {
    const { updateGearItem } = await service();
    const { GearItemNotFoundError } = await import("../lib/gear/inputErrors");
    await assert.rejects(updateGearItem("missing", { name: "x" }), GearItemNotFoundError);
    assert.equal(store.writes.length, 0);
});

test("6. omitted, explicit undefined and explicit null are three different things", async () => {
    const { updateGearItem } = await service();
    await updateGearItem("g1", { name: "Renamed", imageUrl: undefined, genderTarget: undefined, tags: undefined });
    assert.deepEqual(fieldsOf(store.writes[0]), ["name"], "explicit undefined is not written");
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
    const outcomes = await raceBoth(() => updateGearItem("g1", { variants: [] }), () => updateGearItem("g1", { name: "Renamed" }));
    assert.deepEqual(outcomes, ["ok", "ok"]);
    assert.equal(store.get("g1")!.name, "Renamed");
    assert.deepEqual(store.get("g1")!.variants.map((variant) => variant.label), ["Default"]);
});

test("8. invalid input touches the database zero times: no transaction, no read, no write", async () => {
    const { updateGearItem } = await service();
    const bad: Array<Record<string, unknown>> = [
        { tags: null },
        { tags: [1] },
        { variants: null },
        { variants: {} },
        { variants: ["x"] },
        { variants: [{ label: "a", gender: "men", affiliateUrl: "javascript:alert(1)" }] },
        { variants: [{ label: "a", gender: "men", gearItem: { connect: { id: "z" } } }] },
        { variants: [], affiliateUrl: "javascript:alert(1)" },
        { category: "SHOES" },
        { priceRange: "FREE" },
        { weatherSuitability: { sunny: 1 } },
        { weatherSuitability: { rain: Number.NaN } },
        { name: 5 },
        { genderTarget: 7 },
    ];
    for (const input of bad) await assert.rejects(updateGearItem("g1", input as never), () => true, JSON.stringify(input));
    assert.deepEqual(store.calls, []);
    assert.equal(store.writes.length, 0);
    assert.deepEqual(store.get("g1"), makeRow({ id: "g1" }));
});

test("9. legacy invalid affiliate URLs never block unrelated edits, and are not rewritten", async () => {
    const { updateGearItem } = await service();
    fresh({ affiliateUrl: LEGACY_LINK, variants: [{ id: "v1", gearItemId: "g1", label: "Default", gender: "unisex", affiliateUrl: "data:text/html,x", imageUrl: null, price: null, sizes: [] }] });
    const outcomes = await raceBoth(() => updateGearItem("g1", { name: "Renamed" }), () => updateGearItem("g1", { tags: ["x"] }));
    assert.deepEqual(outcomes, ["ok", "ok"]);
    const row = store.get("g1")!;
    assert.equal(row.name, "Renamed");
    assert.deepEqual(row.tags, ["x"]);
    assert.equal(row.affiliateUrl, LEGACY_LINK);
    assert.equal(row.variants[0].affiliateUrl, "data:text/html,x");
    // An unsafe link that IS supplied in the request is still refused.
    await assert.rejects(updateGearItem("g1", { variants: [{ label: "a", gender: "men", affiliateUrl: "javascript:x" }] }));
});

test("the update path never lists the catalog: one transaction, one conditional update, one read of the result", async () => {
    const { updateGearItem } = await service();
    await updateGearItem("g1", { name: "Renamed" });
    assert.deepEqual(store.calls, ["tx.begin", "updateMany", "findUnique", "tx.commit"]);
});

test("10. importer upsert still writes the complete record it supplies, defaults included, replaces variants, and is unconditional", async () => {
    const { upsertGearItem } = await service();
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
    assert.equal(store.writes[0].expectedVersion, undefined, "the importer sends no token");
    assert.equal(row.version, 1, "but its write still increments the version");
});

test("10a. bulk upsert counts are unchanged", async () => {
    const { bulkUpsertGearItems } = await service();
    const summary = await bulkUpsertGearItems([{ name: "Item g1", brandId: "b1", category: "TOP", priceRange: "MID", affiliateUrl: null, tags: ["Rain"], variants: [{ label: "Men", gender: "men" }] }]);
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

test("11. an update with nothing recognized to write is a controlled error with zero database access", async () => {
    const { updateGearItem } = await service();
    const { InvalidGearInputError } = await import("../lib/gear/inputErrors");
    const empty: Array<Record<string, unknown>> = [
        {}, { id: "g1" }, { externalId: "x" }, { name: undefined }, { tags: undefined, variants: undefined },
        { brand: { connect: { id: "x" } } }, { slug: "x" }, { version: 5 }, { weatherSuitability: {} }, { weatherSuitability: { hot: undefined } },
    ];
    for (const input of empty) await assert.rejects(updateGearItem("g1", input as never), InvalidGearInputError, JSON.stringify(input));
    await assert.rejects(updateGearItem("missing", {} as never), InvalidGearInputError, "validation wins over lookup: still no read");
    assert.deepEqual(store.calls, []);
    assert.equal(store.writes.length, 0);
});

test("11b. the repository refuses an empty update for direct callers too, but an explicit weather null is still a supplied value", async () => {
    const { updateGearItem } = await import("../lib/db/gearRepository");
    const { InvalidGearInputError } = await import("../lib/gear/inputErrors");
    const writer = { $transaction: store.$transaction } as never;
    for (const input of [{ id: "g1" }, { id: "g1", name: undefined }, { id: "g1", weatherSuitability: {} }]) {
        await assert.rejects(updateGearItem(input as never, {}, writer), InvalidGearInputError, JSON.stringify(input));
    }
    assert.deepEqual(store.calls, []);
    await updateGearItem({ id: "g1", weatherSuitability: { hot: null } }, {}, writer);
    assert.equal(store.get("g1")!.weatherHot, 0.4, "hot: null keeps its existing behavior (accepted, writes nothing to weatherHot)");
    assert.equal(store.get("g1")!.version, 1, "the accepted no-op update still advances the version");
});

test("11c. weatherSuitability empty-update semantics, at every layer: {} / all-undefined / undefined are refused; hot: null alone stays an accepted no-op (Patch B behavior, unchanged)", async () => {
    const { updateGearItem } = await service();
    const repository = await import("../lib/db/gearRepository");
    const { InvalidGearInputError } = await import("../lib/gear/inputErrors");
    const { updateGearItemSchema } = await import("../lib/validation/adminGear");
    const writer = { $transaction: store.$transaction } as never;

    const nothing: Array<Record<string, unknown>> = [
        { weatherSuitability: {} },
        { weatherSuitability: { hot: undefined, cold: undefined, rain: undefined, wind: undefined } },
        { weatherSuitability: { warm: undefined } },
        { weatherSuitability: undefined },
    ];
    for (const input of nothing) {
        await assert.rejects(updateGearItem("g1", input as never), InvalidGearInputError, `service ${JSON.stringify(input)}`);
        await assert.rejects(repository.updateGearItem({ id: "g1", ...input } as never, {}, writer), InvalidGearInputError, `repository ${JSON.stringify(input)}`);
        assert.equal(updateGearItemSchema.safeParse(input).success, false, `http ${JSON.stringify(input)}`);
    }
    assert.deepEqual(store.calls, [], "none of them touched the database");

    // The protected quirk: `hot: null` on its own writes no column. Both layers still accept it (a supplied value), so it is
    // an update that changes nothing but the bookkeeping (version, updatedAt). Do not "fix" this here: it belongs to Patch B.
    const { data } = repository.buildGearUpdateData({ id: "g1", weatherSuitability: { hot: null } });
    assert.deepEqual(Object.entries(data).filter(([, value]) => value !== undefined), []);
    await updateGearItem("g1", { weatherSuitability: { hot: null } });
    assert.deepEqual(fieldsOf(store.writes[0]), []);
    assert.equal(store.get("g1")!.weatherHot, 0.4);
    assert.equal(updateGearItemSchema.safeParse({ weatherSuitability: { hot: null } }).success, true);

    // ...whereas the legacy `warm` alias, alone or beside `hot: null`, really does clear the column. Existing behavior, pinned as is.
    await updateGearItem("g1", { weatherSuitability: { hot: null, warm: null } } as never); // `warm` is a repository-level legacy alias, not in the service type
    assert.equal(store.get("g1")!.weatherHot, null);
});
