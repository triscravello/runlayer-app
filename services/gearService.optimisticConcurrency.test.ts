import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { Prisma } from "@prisma/client";
import { createGearStore, deferred, fieldsOf, knownRequestError, makeRow } from "../test-support/gearStoreFake";

// Optimistic concurrency (Stage 2B-B): an optional expectedVersion on the service update, applied by ONE conditional UPDATE
// inside a repository transaction. Real service and repository, stateful in-memory Prisma fake.
//
// WHAT THESE TESTS DO NOT PROVE: the fake MODELS PostgreSQL row locking (an UPDATE holds its row until the transaction ends; a second
// writer waits, then re-evaluates its WHERE against the committed row). That the real database and Prisma 5.22 behave this way, that
// the version is checked inside the same statement that writes, and that @updatedAt/rollback behave as assumed are PostgreSQL-dependent
// assumptions. They are listed in the Stage 2B-B report and are what the opt-in local PostgreSQL proof exists to establish.
let store = createGearStore([]);
(globalThis as unknown as { prisma: unknown }).prisma = new Proxy({}, { get: (_target, key) => (store as unknown as Record<string, unknown>)[key as string] });
const fresh = (extra: Record<string, unknown> = {}) => { store = createGearStore([makeRow({ id: "g1", ...extra }), makeRow({ id: "g2", name: "Other Tee" })]); };
beforeEach(() => fresh());

const service = () => import("./gearService");
const errors = () => import("../lib/gear/inputErrors");

/** A holds the row lock (parked); B starts and is observed blocked behind it; then A is released. Resolves with both outcomes. */
async function raceBoth(first: () => Promise<unknown>, second: () => Promise<unknown>) {
    const held = deferred();
    const release = deferred();
    const blocked = deferred();
    let parked = false;
    store.hooks.afterLock = async () => { if (!parked) { parked = true; held.resolve(); await release.promise; } };
    store.hooks.onBlocked = () => blocked.resolve();
    const a = first().then((value) => ({ ok: value }), (error: unknown) => ({ error }));
    await held.promise;
    const b = second().then((value) => ({ ok: value }), (error: unknown) => ({ error }));
    await blocked.promise;
    assert.equal(store.state.blocked, 1, "B is waiting on A's row lock, not merely scheduled");
    release.resolve();
    return Promise.all([a, b]);
}

test("a fresh token succeeds, increments the version once and returns the new version", async () => {
    const { updateGearItem } = await service();
    const updated = await updateGearItem("g1", { name: "Renamed" }, { expectedVersion: 0 });
    assert.equal((updated as { version: number }).version, 1);
    assert.equal(store.get("g1")!.version, 1);
    assert.equal(store.writes[0].expectedVersion, 0);
    assert.deepEqual(fieldsOf(store.writes[0]), ["name"], "Stage 1 sparse payload: only the supplied field");
    // The next edit must use the new token.
    await updateGearItem("g1", { tags: ["x"] }, { expectedVersion: 1 });
    assert.equal(store.get("g1")!.version, 2);
});

test("a stale token is rejected with a typed error, no durable write, and the transaction rolled back", async () => {
    const { updateGearItem } = await service();
    const { GearItemStaleVersionError } = await errors();
    await updateGearItem("g1", { name: "First" }, { expectedVersion: 0 });
    const before = structuredClone(store.get("g1"));
    await assert.rejects(updateGearItem("g1", { name: "Second", variants: [{ label: "X", gender: "men" }] }, { expectedVersion: 0 }), GearItemStaleVersionError);
    assert.deepEqual(store.get("g1"), before, "nothing changed: scalars, version and variants");
    assert.equal(store.writes.length, 1, "only the first update is durable");
    assert.equal(store.state.rolledBack, 1);
    assert.equal(store.calls.includes("variant.deleteMany"), false, "variants were never touched");
});

test("two simultaneous updates with the same token: exactly one wins, the loser changes nothing", async () => {
    const { updateGearItem } = await service();
    const { GearItemStaleVersionError } = await errors();
    const [a, b] = await raceBoth(
        () => updateGearItem("g1", { name: "From A", variants: [{ label: "A", gender: "men" }] }, { expectedVersion: 0 }),
        () => updateGearItem("g1", { name: "From B", tags: ["b"], variants: [{ label: "B", gender: "women" }] }, { expectedVersion: 0 }),
    );
    assert.ok("ok" in a);
    assert.ok("error" in b && b.error instanceof GearItemStaleVersionError);
    const row = store.get("g1")!;
    assert.equal(row.version, 1, "incremented exactly once");
    assert.equal(row.name, "From A");
    assert.deepEqual(row.tags, ["light"], "B's scalar change was not applied");
    assert.deepEqual(row.variants.map((variant) => variant.label), ["A"], "B's variants were not applied");
    assert.equal(store.writes.length, 1);
});

test("scalar update versus variant replacement with the same token: the second is stale; retrying with the new token succeeds", async () => {
    const { updateGearItem } = await service();
    const { GearItemStaleVersionError } = await errors();
    const [a, b] = await raceBoth(
        () => updateGearItem("g1", { variants: [{ label: "Men", gender: "men" }] }, { expectedVersion: 0 }),
        () => updateGearItem("g1", { priceRange: "PREMIUM" }, { expectedVersion: 0 }),
    );
    assert.ok("ok" in a);
    assert.ok("error" in b && b.error instanceof GearItemStaleVersionError);
    assert.equal(store.get("g1")!.priceRange, "MID");
    await updateGearItem("g1", { priceRange: "PREMIUM" }, { expectedVersion: 1 });
    assert.equal(store.get("g1")!.priceRange, "PREMIUM");
    assert.deepEqual(store.get("g1")!.variants.map((variant) => variant.label), ["Men"]);
});

test("the reverse order: scalar first, then a variant replacement with the same token", async () => {
    const { updateGearItem } = await service();
    const { GearItemStaleVersionError } = await errors();
    const [a, b] = await raceBoth(
        () => updateGearItem("g1", { priceRange: "PREMIUM" }, { expectedVersion: 0 }),
        () => updateGearItem("g1", { variants: [{ label: "Men", gender: "men" }] }, { expectedVersion: 0 }),
    );
    assert.ok("ok" in a);
    assert.ok("error" in b && b.error instanceof GearItemStaleVersionError);
    assert.deepEqual(store.get("g1")!.variants.map((variant) => variant.label), ["Default"], "the stale variants replacement did not happen");
});

test("two variant replacements with the same token: the second is stale and the first one's variants remain", async () => {
    const { updateGearItem } = await service();
    const { GearItemStaleVersionError } = await errors();
    const [a, b] = await raceBoth(
        () => updateGearItem("g1", { variants: [{ label: "One", gender: "men" }] }, { expectedVersion: 0 }),
        () => updateGearItem("g1", { variants: [{ label: "Two", gender: "women" }] }, { expectedVersion: 0 }),
    );
    assert.ok("ok" in a);
    assert.ok("error" in b && b.error instanceof GearItemStaleVersionError);
    assert.deepEqual(store.get("g1")!.variants.map((variant) => variant.label), ["One"]);
});

test("a variants-only update still increments the version (the parent row is always written)", async () => {
    const { updateGearItem } = await service();
    await updateGearItem("g1", { variants: [{ label: "Men", gender: "men" }] });
    assert.equal(store.get("g1")!.version, 1);
    assert.deepEqual(fieldsOf(store.writes[0]), [], "no scalar column was written");
    assert.deepEqual(store.writes[0].variants, ["Men"]);
});

test("variants: [] builds the Default from links read under the lock: an importer link change that commits first makes a tokened save stale, never a stale Default", async () => {
    const { updateGearItem } = await service();
    const { GearItemStaleVersionError } = await errors();
    const [a, b] = await raceBoth(
        () => updateGearItem("g1", { affiliateUrl: "https://e.test/changed" }),
        () => updateGearItem("g1", { variants: [] }, { expectedVersion: 0 }),
    );
    assert.ok("ok" in a);
    assert.ok("error" in b && b.error instanceof GearItemStaleVersionError);
    assert.equal(store.get("g1")!.variants[0].affiliateUrl, "https://e.test/a", "variants were not rebuilt from a stale link");
});

test("variants: [] without a token: the Default always matches the link as committed at that moment, in either order", async () => {
    const { updateGearItem } = await service();
    // Link change commits first, then the Default is built: it sees the NEW link.
    await raceBoth(() => updateGearItem("g1", { affiliateUrl: "https://e.test/changed" }), () => updateGearItem("g1", { variants: [] }));
    assert.equal(store.get("g1")!.variants[0].affiliateUrl, "https://e.test/changed");
    assert.equal(store.get("g1")!.affiliateUrl, "https://e.test/changed");

    // Default is built first, then the link changes: the Default keeps the link it was built from (variants are not recomputed).
    fresh();
    await raceBoth(() => updateGearItem("g1", { variants: [] }), () => updateGearItem("g1", { affiliateUrl: "https://e.test/changed" }));
    assert.equal(store.get("g1")!.variants[0].affiliateUrl, "https://e.test/a");
    assert.equal(store.get("g1")!.affiliateUrl, "https://e.test/changed");
});

test("variants: [] together with a link in the same request uses that link, and an unsafe one is refused before any database access", async () => {
    const { updateGearItem } = await service();
    await updateGearItem("g1", { variants: [], affiliateUrl: "https://e.test/new" }, { expectedVersion: 0 });
    assert.equal(store.get("g1")!.variants[0].affiliateUrl, "https://e.test/new");
    fresh();
    await assert.rejects(updateGearItem("g1", { variants: [], affiliateUrl: "javascript:alert(1)" }, { expectedVersion: 0 }));
    assert.deepEqual(store.calls, []);
});

test("a missing item is not-found, never stale: with and without a token, and when it disappears while the update waits", async () => {
    const { updateGearItem } = await service();
    const { GearItemNotFoundError } = await errors();
    await assert.rejects(updateGearItem("missing", { name: "x" }, { expectedVersion: 0 }), GearItemNotFoundError);
    await assert.rejects(updateGearItem("missing", { name: "x" }), GearItemNotFoundError);

    const held = deferred();
    const release = deferred();
    const blocked = deferred();
    store.hooks.beforeDelete = async () => { held.resolve(); await release.promise; };
    store.hooks.onBlocked = () => blocked.resolve();
    const deleting = store.gearItem.delete({ where: { id: "g1" } });
    await held.promise;
    const updating = updateGearItem("g1", { name: "x" }, { expectedVersion: 0 }).then(() => "ok", (error: unknown) => error);
    await blocked.promise;
    release.resolve();
    await deleting;
    assert.ok((await updating) instanceof GearItemNotFoundError);
    assert.deepEqual(store.writes.map((write) => write.op), ["delete"]);
});

test("update versus delete: an update that commits first is followed by the delete", async () => {
    const { updateGearItem } = await service();
    const held = deferred();
    const release = deferred();
    const blocked = deferred();
    store.hooks.afterLock = async () => { held.resolve(); await release.promise; };
    store.hooks.onBlocked = () => blocked.resolve();
    const updating = updateGearItem("g1", { name: "Renamed" }, { expectedVersion: 0 });
    await held.promise;
    const deleting = store.gearItem.delete({ where: { id: "g1" } });
    await blocked.promise;
    release.resolve();
    await Promise.all([updating, deleting]);
    assert.deepEqual(store.writes.map((write) => write.op), ["update", "delete"]);
});

test("an unconditional (importer-style) update never needs a token, increments the version, and makes an older browser token stale", async () => {
    const { upsertGearItem, updateGearItem } = await service();
    const { GearItemStaleVersionError } = await errors();
    const { importGearItemsSchema } = await import("../lib/validation/adminGear");
    const [record] = importGearItemsSchema.parse([{ name: "Item g1", brandId: "b1", category: "TOP", priceRange: "MID", affiliateUrl: null }]);
    assert.equal((await upsertGearItem(record)).action, "updated");
    assert.equal(store.get("g1")!.version, 1);
    assert.equal(store.writes[0].expectedVersion, undefined);
    await assert.rejects(updateGearItem("g1", { name: "Browser edit" }, { expectedVersion: 0 }), GearItemStaleVersionError);
    assert.equal(store.get("g1")!.name, "Item g1");
});

test("an unconditional update racing a tokened one is last-write-wins for the importer: it waits, then applies", async () => {
    const { updateGearItem } = await service();
    const [a, b] = await raceBoth(
        () => updateGearItem("g1", { name: "Browser" }, { expectedVersion: 0 }),
        () => updateGearItem("g1", { name: "Importer" }),
    );
    assert.ok("ok" in a && "ok" in b);
    assert.equal(store.get("g1")!.name, "Importer");
    assert.equal(store.get("g1")!.version, 2);
});

test("a failure after the parent update (duplicate variants, or a name clash) rolls the whole transaction back", async () => {
    const { updateGearItem } = await service();
    const before = structuredClone(store.get("g1"));
    await assert.rejects(updateGearItem("g1", { name: "Changed", tags: ["t"], variants: [{ label: "D", gender: "men" }, { label: "D", gender: "men" }] }, { expectedVersion: 0 }), (error: { code?: string }) => error.code === "P2002");
    assert.deepEqual(store.get("g1"), before, "parent scalars, version and the original variants are all untouched");
    assert.equal(store.state.rolledBack, 1);
    assert.equal(store.writes.length, 0);

    await assert.rejects(updateGearItem("g1", { name: "Other Tee" }, { expectedVersion: 0 }), (error: { code?: string }) => error.code === "P2002");
    assert.deepEqual(store.get("g1"), before);
});

test("a transaction timeout (P2028) is passed through untouched and never reported as a stale version", async () => {
    const { updateGearItem } = await service();
    const { GearItemStaleVersionError, GearItemNotFoundError } = await errors();
    const timeout = new Prisma.PrismaClientKnownRequestError("fake timeout", { code: "P2028", clientVersion: "test" });
    store.hooks.afterLock = () => { throw timeout; };
    await assert.rejects(updateGearItem("g1", { name: "x" }, { expectedVersion: 0 }), (error: unknown) => error === timeout && !(error instanceof GearItemStaleVersionError) && !(error instanceof GearItemNotFoundError));
    assert.equal(store.get("g1")!.version, 0);
    assert.equal(store.state.rolledBack, 1);
});

test("a malformed token is refused before any database access", async () => {
    const { updateGearItem } = await service();
    const { InvalidGearInputError } = await errors();
    const bad: unknown[] = [null, "1", "", -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, Number.MAX_SAFE_INTEGER + 1, true, {}, [0], BigInt(1)];
    for (const token of bad) {
        await assert.rejects(updateGearItem("g1", { name: "x" }, { expectedVersion: token as never }), InvalidGearInputError, String(typeof token));
    }
    assert.deepEqual(store.calls, []);
    assert.equal(store.writes.length, 0);
    // The edges of the valid range are accepted (and simply stale here).
    const { GearItemStaleVersionError } = await errors();
    await assert.rejects(updateGearItem("g1", { name: "x" }, { expectedVersion: 2_147_483_647 }), GearItemStaleVersionError);
});

test("a token with nothing to write is an empty update: refused with zero database access", async () => {
    const { updateGearItem } = await service();
    const { InvalidGearInputError } = await errors();
    await assert.rejects(updateGearItem("g1", {}, { expectedVersion: 0 }), InvalidGearInputError);
    await assert.rejects(updateGearItem("g1", { name: undefined }, { expectedVersion: 0 }), InvalidGearInputError);
    assert.deepEqual(store.calls, []);
});

test("a client can not write version: the repository rejects it, and the service never forwards it", async () => {
    const { updateGearItem } = await service();
    const repository = await import("../lib/db/gearRepository");
    await assert.rejects(repository.updateGearItem({ id: "g1", name: "x", version: 99 } as never, {}, { $transaction: store.$transaction } as never), repository.InvalidGearUpdateError);
    assert.deepEqual(store.calls, []);
    await updateGearItem("g1", { name: "x", version: 99 } as never);
    assert.equal(store.get("g1")!.version, 1, "incremented by one, not set to the submitted value");
    assert.equal("version" in (store.writes[0].data ?? {}), false);
});

test("Stage 1 sparse PATCH is unchanged under a token: only supplied fields are written, null clears, [] replaces", async () => {
    const { updateGearItem } = await service();
    await updateGearItem("g1", { imageUrl: null, tags: [], subcategory: undefined }, { expectedVersion: 0 });
    assert.deepEqual(fieldsOf(store.writes[0]).sort(), ["imageUrl", "tags"]);
    const row = store.get("g1")!;
    assert.equal(row.imageUrl, null);
    assert.deepEqual(row.tags, []);
    assert.equal(row.subcategory, "tee");
    assert.equal(row.name, "Item g1");
});

test("the fake itself: blocked writers are observable, locks are released on commit and rollback", async () => {
    const { updateGearItem } = await service();
    await updateGearItem("g1", { name: "a" });
    await assert.rejects(updateGearItem("g1", { name: "b" }, { expectedVersion: 0 }));
    assert.deepEqual(store.lockedIds(), []);
    assert.deepEqual([store.state.committed, store.state.rolledBack], [1, 1]);
    void knownRequestError;
});

// ---------------------------------------------------------------------------------------------------------------------
// Review additions: updatedAt handling and a transaction audit (what runs, in which order, on which client).
// ---------------------------------------------------------------------------------------------------------------------

test("updatedAt is generated per update operation and is never part of the concurrency condition", async () => {
    const { updateGearItem, upsertGearItem } = await service();
    const before = Date.now();
    await updateGearItem("g1", { name: "a" }, { expectedVersion: 0 });
    await updateGearItem("g1", { name: "b" });
    const { importGearItemsSchema } = await import("../lib/validation/adminGear");
    await upsertGearItem(importGearItemsSchema.parse([{ name: "b", brandId: "b1", category: "TOP", priceRange: "MID", affiliateUrl: null }])[0]);
    const after = Date.now();

    const [tokened, plain, importer] = store.updateManyCalls;
    assert.deepEqual(tokened.where, { id: "g1", version: 0 }, "the condition is id + version only");
    assert.deepEqual(plain.where, { id: "g1" }, "an unconditional update is conditioned on id alone");
    assert.deepEqual(importer.where, { id: "g1" }, "the importer path is identical to a direct unconditional update");
    const stamps = [tokened, plain, importer].map((call) => {
        assert.ok(call.data.updatedAt instanceof Date, "updatedAt is a Date set by the application");
        assert.deepEqual(call.data.version, { increment: 1 });
        return call.data.updatedAt as Date;
    });
    assert.equal(new Set(stamps).size, 3, "a fresh timestamp object per operation");
    for (const stamp of stamps) assert.ok(stamp.getTime() >= before && stamp.getTime() <= after);
    assert.ok(stamps[0].getTime() <= stamps[1].getTime() && stamps[1].getTime() <= stamps[2].getTime(), "operations in sequence get non-decreasing timestamps");

    // A rejected (stale) attempt also never puts updatedAt in the condition.
    await assert.rejects(updateGearItem("g1", { name: "c" }, { expectedVersion: 0 }));
    assert.equal("updatedAt" in store.updateManyCalls.at(-1)!.where, false);
});

test("transaction audit: the exact operations and their order for each kind of update", async () => {
    const { updateGearItem } = await service();
    const { GearItemNotFoundError, GearItemStaleVersionError } = await errors();
    const run = async (work: () => Promise<unknown>) => { store.calls.length = 0; await work().catch(() => undefined); return [...store.calls]; };

    assert.deepEqual(await run(() => updateGearItem("g1", { name: "a" }, { expectedVersion: 0 })), ["tx.begin", "updateMany", "findUnique", "tx.commit"], "success: no missing/stale classification read");
    assert.deepEqual(await run(() => updateGearItem("g1", { variants: [{ label: "M", gender: "men" }] })), ["tx.begin", "updateMany", "variant.deleteMany", "variant.createMany", "findUnique", "tx.commit"], "variants only after the parent update");
    assert.deepEqual(await run(() => updateGearItem("g1", { variants: [] })), ["tx.begin", "updateMany", "findUnique", "variant.deleteMany", "variant.createMany", "findUnique", "tx.commit"], "Default links are read after the parent update");
    assert.deepEqual(await run(() => updateGearItem("g1", { name: "z" }, { expectedVersion: 0 })), ["tx.begin", "updateMany", "findUnique", "tx.rollback"], "stale: classification read only after count 0, then rollback");
    assert.deepEqual(await run(() => updateGearItem("nope", { name: "z" })), ["tx.begin", "updateMany", "tx.rollback"], "unconditional + missing: no classification read at all");
    await assert.rejects(updateGearItem("g1", { name: "z" }, { expectedVersion: 0 }), GearItemStaleVersionError);
    await assert.rejects(updateGearItem("nope", { name: "z" }, { expectedVersion: 0 }), GearItemNotFoundError);
});

test("transaction audit: the Default's links are read only after the parent row lock is held, never while waiting for it", async () => {
    const { updateGearItem } = await service();
    const held = deferred();
    const release = deferred();
    const blocked = deferred();
    let parked = false;
    store.hooks.afterLock = async () => { if (!parked) { parked = true; held.resolve(); await release.promise; } };
    store.hooks.onBlocked = () => blocked.resolve();
    const a = updateGearItem("g1", { affiliateUrl: "https://e.test/changed" });
    await held.promise;
    const b = updateGearItem("g1", { variants: [] });
    await blocked.promise;
    assert.deepEqual(store.calls, ["tx.begin", "updateMany", "tx.begin", "updateMany"], "B's links have not been read: it is still waiting for the lock");
    release.resolve();
    await Promise.all([a, b]);
    assert.equal(store.get("g1")!.variants[0].affiliateUrl, "https://e.test/changed");
});

test("transaction audit: variant operations exist only on the transaction client", async () => {
    const { updateGearItem } = await service();
    assert.equal((store as unknown as Record<string, unknown>).gearItemVariant, undefined, "the base client has no variant model, so a variant write outside the transaction would throw");
    await updateGearItem("g1", { variants: [{ label: "M", gender: "men" }] });
    assert.deepEqual(store.get("g1")!.variants.map((variant) => variant.label), ["M"]);
});

test("transaction audit: an unexpected update count fails safely with no variant writes; any other failure propagates unchanged and rolls back", async () => {
    const repository = await import("../lib/db/gearRepository");
    const calls: string[] = [];
    const twoRows = { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
        gearItem: { updateMany: async () => { calls.push("updateMany"); return { count: 2 }; }, findUnique: async () => { calls.push("findUnique"); return null; } },
        gearItemVariant: { deleteMany: async () => { calls.push("deleteMany"); }, createMany: async () => { calls.push("createMany"); } },
    }) };
    await assert.rejects(repository.updateGearItem({ id: "g1", variants: [{ label: "M", gender: "men" }] } as never, {}, twoRows as never), /Unexpected gear item update count/);
    assert.deepEqual(calls, ["updateMany"], "nothing was read or written after the unexpected count");

    const { updateGearItem } = await service();
    const boom = new Error("boom");
    store.hooks.afterLock = () => { throw boom; };
    await assert.rejects(updateGearItem("g1", { name: "x" }, { expectedVersion: 0 }), (error: unknown) => error === boom);
    assert.equal(store.get("g1")!.version, 0);
    assert.equal(store.state.rolledBack, 1);
});
