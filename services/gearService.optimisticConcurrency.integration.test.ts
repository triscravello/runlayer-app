import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { checkTestDatabase } from "../lib/auth/testDatabaseGuard";

/**
 * Optimistic concurrency (Stage 2B) against a REAL PostgreSQL database. Skipped by default; NOT part of the offline suite.
 *
 * Unlike the in-memory fake tests, nothing here is modelled: the production repository code runs against real PostgreSQL
 * transactions, real row locks, real READ COMMITTED re-evaluation and real constraint failures.
 *
 * To run it, point it at a dedicated, throwaway LOCAL database whose schema is already migrated (this test never applies
 * migrations and never touches DATABASE_URL's database):
 *
 *   RUNLAYER_ALLOW_DB_TESTS=1 \
 *   RUNLAYER_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/runlayer_proof_test \
 *   node scripts/runTests.mjs --integration services/gearService.optimisticConcurrency.integration.test.ts
 *
 * Safeguards: the shared guard (lib/auth/testDatabaseGuard.ts: explicit opt-in, local host, database name contains "test", differs
 * from DATABASE_URL); this file additionally refuses port 5432 (where a real local server may live) and asks the server it reached
 * for its database name and port before anything is written. Every row it creates carries a unique marker prefix and only those
 * rows are deleted; unrelated rows are counted before and after to prove nothing else was touched.
 *
 * Ordering is established by OBSERVED SERVER STATE, not by sleeps: a transaction is parked while it holds a row lock (the
 * wrapper below forwards every call to the real transaction and only pauses after `updateMany` has returned), a second writer is
 * started through the normal client so it really blocks inside PostgreSQL, and the test waits until pg_stat_activity shows a
 * backend waiting on a lock before releasing the first one.
 */
const check = checkTestDatabase(process.env);
// Opt-in progress trace to stderr (RUNLAYER_TEST_TRACE=1): the test reporter prints a subtest only after its parent finishes, so this is the way to see where a run is stuck.
const trace = (message: string) => { if (process.env.RUNLAYER_TEST_TRACE) process.stderr.write(`[trace ${new Date().toISOString().slice(11, 23)}] ${message}\n`); };

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

test(
    "optimistic concurrency against a real PostgreSQL database",
    { skip: check.ok ? false : `skipped: ${check.reason}`, timeout: 120_000 },
    async (t) => {
        assert.ok(check.ok);

        // Refuse the default port BEFORE any connection is made (a URL without a port means 5432, where a real local server may live).
        const target = new URL(check.url);
        assert.notEqual(Number(target.port || 5432), 5432, "never the default PostgreSQL port: use a dedicated throwaway server on its own port");

        // The app's shared Prisma client reads DATABASE_URL when first imported: point it at the test database BEFORE importing it.
        process.env.DATABASE_URL = check.url;
        const { prisma } = await import("@/lib/prisma");
        const { Prisma } = await import("@prisma/client");
        const repository = await import("@/lib/db/gearRepository");
        const { updateGearItem, upsertGearItem } = await import("@/services/gearService");
        const { GearItemNotFoundError, GearItemStaleVersionError } = await import("@/lib/gear/inputErrors");
        const { toBrandIdentity } = await import("@/lib/ingestion/brandResolution");

        const marker = `oc-${randomUUID().slice(0, 8)}`;
        const nameOf = (suffix: string) => `${marker}-${suffix}`;
        const L0 = "https://shop.example.com/original";
        const L1 = "https://shop.example.com/changed";

        // --- Helpers ---------------------------------------------------------------------------------------------------
        const brandData = (name: string) => toBrandIdentity(name) as NonNullable<ReturnType<typeof toBrandIdentity>>;
        let brandId = "";

        async function createItem(suffix: string, extra: Record<string, unknown> = {}) {
            const row = await prisma.gearItem.create({
                data: {
                    name: nameOf(suffix), brandId, category: "TOP", priceRange: "MID", tags: ["light"], bodyTypeFit: ["slim"],
                    imageUrl: "https://shop.example.com/image.png", affiliateUrl: L0, genderTarget: "men", subcategory: "tee",
                    variants: { create: [{ label: nameOf("Default"), gender: "unisex", affiliateUrl: L0, sizes: ["M"], price: 20 }] },
                    ...extra,
                },
            });
            return row.id;
        }
        const read = (id: string) => prisma.gearItem.findUniqueOrThrow({ where: { id }, include: { variants: { orderBy: [{ label: "asc" }, { gender: "asc" }] } } });
        const snapshot = async (id: string) => JSON.stringify(await read(id));

        /** Rows that do NOT belong to this test, counted so the test can prove it touched nothing else. */
        const unrelated = async () => ({
            items: await prisma.gearItem.count({ where: { NOT: { name: { startsWith: marker } } } }),
            variants: await prisma.gearItemVariant.count({ where: { gearItem: { NOT: { name: { startsWith: marker } } } } }),
            brands: await prisma.brand.count({ where: { NOT: { name: { startsWith: marker } } } }),
        });

        // The parked ("holder") transaction must outlive the 5 s default that the production code runs with, so that a SECOND writer is the
        // only one that can time out. (A holder that expires first is rolled back by Prisma, which releases the lock.)
        const HOLDER_TIMEOUT = { timeout: 60_000, maxWait: 10_000 };

        /**
         * A client for the repository whose transaction does everything for real, but pauses once after `updateMany` has returned,
         * i.e. while the parent row lock is held. `ops` records the calls made on the transaction, in order.
         */
        function parkedClient() {
            const held = deferred();
            const release = deferred();
            const ops: string[] = [];
            setTimeout(() => release.resolve(), 40_000).unref();           // safety net: a parked holder always unwinds, even if the scenario failed early
            const client = {
                $transaction: <T,>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction(async (tx) => fn({
                    gearItem: {
                        updateMany: async (args: Parameters<typeof tx.gearItem.updateMany>[0]) => {
                            ops.push("updateMany");
                            const result = await tx.gearItem.updateMany(args);
                            held.resolve();
                            await release.promise;
                            return result;
                        },
                        findUnique: (args: Parameters<typeof tx.gearItem.findUnique>[0]) => { ops.push("findUnique"); return tx.gearItem.findUnique(args); },
                    },
                    gearItemVariant: {
                        deleteMany: (args: Parameters<typeof tx.gearItemVariant.deleteMany>[0]) => { ops.push("deleteMany"); return tx.gearItemVariant.deleteMany(args); },
                        createMany: (args: Parameters<typeof tx.gearItemVariant.createMany>[0]) => { ops.push("createMany"); return tx.gearItemVariant.createMany(args); },
                    },
                }), HOLDER_TIMEOUT),
            };
            return { client: client as never, held, release, ops };
        }

        /** Resolves once the server reports `count` backends waiting on a lock (bounded poll of an observable condition). */
        async function waitUntilBlocked(count = 1) {
            trace("waiting for a blocked writer");
            for (let attempt = 0; attempt < 600; attempt += 1) {
                const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`select count(*)::bigint as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock'`;
                if (Number(row.n) >= count) return;
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            throw new Error("the second writer never showed up as waiting on a lock");
        }
        async function waitUntilNoneBlocked() {
            for (let attempt = 0; attempt < 600; attempt += 1) {
                const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`select count(*)::bigint as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock'`;
                if (Number(row.n) === 0) return;
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            throw new Error("a backend is still waiting on a lock");
        }
        /** A wait that fails the scenario instead of hanging it, e.g. when the code under test never reaches the point being waited for. */
        const within = <T,>(promise: Promise<T>, what: string, ms = 15_000) => Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms).unref())]);
        const settle = <T,>(promise: Promise<T>) => promise.then((value) => ({ ok: value }), (error: unknown) => ({ error }));

        // Cleanup runs only once the server has been positively identified, so a wrong target is never sent a delete.
        let verified = false;
        try {
            trace("connected; checking target");
            // --- Read-only target check, before anything is written ----------------------------------------------------------
            const [reached] = await prisma.$queryRaw<Array<{ db: string; port: number | null; version: string; addr: string | null; isolation: string }>>`select current_database() as db, inet_server_port() as port, current_setting('server_version') as version, host(inet_server_addr()) as addr, current_setting('default_transaction_isolation') as isolation`;
            assert.equal(reached.db, decodeURIComponent(target.pathname.replace(/^\//, "")), "connected to the intended database");
            assert.equal(Number(reached.port), Number(target.port), "connected to the intended server port");
            assert.notEqual(Number(reached.port), 5432, "never the default port, where a real local server may live");
            assert.ok(reached.addr === "127.0.0.1" || reached.addr === "::1", "the server was reached over loopback");
            assert.equal(reached.isolation, "read committed", "the default isolation level is READ COMMITTED, which the design assumes");
            verified = true;
            t.diagnostic(`PostgreSQL ${reached.version} on loopback, port ${reached.port}, database ${reached.db}, isolation ${reached.isolation}`);

            const unrelatedBefore = await unrelated();
            brandId = (await prisma.brand.create({ data: brandData(nameOf("brand")) })).id;

            // ------------------------------------------------------------------------------------------------------------------
            await t.test("A. two concurrent updates with the same expectedVersion: exactly one wins and the loser changes nothing", async () => {
                trace("start A");
                const id = await createItem("a");
                const originalVariantIds = (await read(id)).variants.map((variant) => variant.id);
                const parked = parkedClient();
                const winner = repository.updateGearItem({ id, name: nameOf("a-from-A"), variants: [{ label: nameOf("A-variant"), gender: "men" }] }, { expectedVersion: 0 }, parked.client);
                await within(parked.held.promise, "the holder to take the row lock");                                  // A holds the row lock (uncommitted)
                const loser = settle(updateGearItem(id, { name: nameOf("a-from-B"), tags: ["from-b"], variants: [{ label: nameOf("B-variant"), gender: "women" }] }, { expectedVersion: 0 }));
                await waitUntilBlocked();                                   // B is genuinely waiting inside PostgreSQL
                parked.release.resolve();
                await winner;
                const outcome = await loser;

                assert.ok("error" in outcome && outcome.error instanceof GearItemStaleVersionError, "the loser receives the typed stale-version error");
                const row = await read(id);
                assert.equal(row.version, 1, "the version incremented exactly once");
                assert.equal(row.name, nameOf("a-from-A"));
                assert.deepEqual(row.tags, ["light"], "the loser's scalar change was not applied");
                assert.deepEqual(row.variants.map((variant) => variant.label), [nameOf("A-variant")], "only the winner's variants exist");
                assert.equal(row.variants.some((variant) => originalVariantIds.includes(variant.id)), false, "the winner replaced the original variants");
                assert.equal(await prisma.gearItemVariant.count({ where: { label: nameOf("B-variant") } }), 0, "no variant row of the loser exists anywhere");
                assert.deepEqual(parked.ops, ["updateMany", "deleteMany", "createMany", "findUnique"], "the winner ran one conditional update, then its variants, then the read-back");
            });

            await t.test("A2. a scalar update racing a variant replacement with the same token: the second is stale, a retry with the new token succeeds", async () => {
                trace("start A2");
                const id = await createItem("a2");
                const parked = parkedClient();
                const first = repository.updateGearItem({ id, variants: [{ label: nameOf("Men"), gender: "men" }] }, { expectedVersion: 0 }, parked.client);
                await within(parked.held.promise, "the holder to take the row lock");
                const second = settle(updateGearItem(id, { priceRange: "PREMIUM" }, { expectedVersion: 0 }));
                await waitUntilBlocked();
                parked.release.resolve();
                await first;
                assert.ok("error" in (await second) && (await second as { error: unknown }).error instanceof GearItemStaleVersionError);
                assert.equal((await read(id)).priceRange, "MID");
                await updateGearItem(id, { priceRange: "PREMIUM" }, { expectedVersion: 1 });
                const row = await read(id);
                assert.deepEqual([row.priceRange, row.version, row.variants.map((variant) => variant.label)], ["PREMIUM", 2, [nameOf("Men")]]);
            });

            await t.test("B. a stale expectedVersion is rejected without any durable change (parent, version, updatedAt, variants)", async () => {
                trace("start B");
                const id = await createItem("b");
                await updateGearItem(id, { name: nameOf("b-first") }, { expectedVersion: 0 });
                const before = await snapshot(id);
                await assert.rejects(updateGearItem(id, { name: nameOf("b-second"), tags: ["x"], variants: [{ label: nameOf("B2"), gender: "men" }] }, { expectedVersion: 0 }), GearItemStaleVersionError);
                assert.equal(await snapshot(id), before, "byte-identical row including updatedAt and variant ids/timestamps");
                assert.equal((await read(id)).version, 1);
            });

            await t.test("C. a genuine database constraint failure AFTER the parent update rolls everything back", async () => {
                trace("start C");
                const id = await createItem("c");
                await createItem("c-other");
                const before = await snapshot(id);
                const parked = parkedClient();
                parked.release.resolve();                                    // no pause needed here; the wrapper just records the call order
                const duplicate = { label: nameOf("dup"), gender: "men" };
                await assert.rejects(
                    repository.updateGearItem({ id, name: nameOf("c-changed"), tags: ["changed"], variants: [duplicate, duplicate] }, { expectedVersion: 0 }, parked.client),
                    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
                );
                assert.deepEqual(parked.ops, ["updateMany", "deleteMany", "createMany"], "the parent UPDATE and the variant delete had already run when createMany violated the unique constraint");
                assert.equal(await snapshot(id), before, "parent scalars, version, updatedAt and the ORIGINAL variants (same ids) are all back to what they were");
                assert.equal(await prisma.gearItemVariant.count({ where: { label: nameOf("dup") } }), 0);

                // A name collision fails inside the parent UPDATE itself (unique name+brand): same outcome, nothing partial.
                await assert.rejects(
                    updateGearItem(id, { name: nameOf("c-other"), variants: [{ label: nameOf("never"), gender: "men" }] }, { expectedVersion: 0 }),
                    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
                );
                assert.equal(await snapshot(id), before);
            });

            await t.test("D. variants: [] under contention builds its Default from links read AFTER the parent update holds the lock", async () => {
                trace("start D");
                // Order 1: a link change holds the lock; the Default writer blocks, then must see the NEW link.
                const id = await createItem("d1");
                const holder = parkedClient();
                const linkChange = repository.updateGearItem({ id, affiliateUrl: L1 }, {}, holder.client);
                await within(holder.held.promise, "the holder to take the row lock");
                const defaulting = updateGearItem(id, { variants: [] });
                await waitUntilBlocked();
                holder.release.resolve();
                await linkChange;
                await defaulting;
                let row = await read(id);
                assert.equal(row.affiliateUrl, L1);
                assert.deepEqual(row.variants.map((variant) => [variant.label, variant.gender, variant.affiliateUrl]), [["Default", "unisex", L1]], "a pre-read of the links would have produced the old link; the post-lock read produced the new one");
                assert.equal(row.version, 2);

                // Order 2: the Default writer holds the lock first; the link change waits. The Default keeps the link it was built from.
                const id2 = await createItem("d2");
                const defaultHolder = parkedClient();
                const building = repository.updateGearItem({ id: id2, variants: [] }, {}, defaultHolder.client);
                await within(defaultHolder.held.promise, "the holder to take the row lock");
                const changing = updateGearItem(id2, { affiliateUrl: L1 });
                await waitUntilBlocked();
                defaultHolder.release.resolve();
                await building;
                await changing;
                row = await read(id2);
                assert.equal(row.affiliateUrl, L1);
                assert.deepEqual(row.variants.map((variant) => variant.affiliateUrl), [L0], "built from the committed link at that moment; later link changes do not rewrite variants");

                // With a token: an importer-style link change that commits first makes the tokened Default save STALE, never a stale Default.
                const id3 = await createItem("d3");
                const importerHolder = parkedClient();
                const importerWrite = repository.updateGearItem({ id: id3, affiliateUrl: L1 }, {}, importerHolder.client);
                await within(importerHolder.held.promise, "the holder to take the row lock");
                const tokened = settle(updateGearItem(id3, { variants: [] }, { expectedVersion: 0 }));
                await waitUntilBlocked();
                importerHolder.release.resolve();
                await importerWrite;
                assert.ok("error" in (await tokened) && (await tokened as { error: unknown }).error instanceof GearItemStaleVersionError);
                assert.deepEqual((await read(id3)).variants.map((variant) => variant.label), [nameOf("Default")], "the original variants are untouched");
            });

            await t.test("E. importer versus tokened update, in both commit orders", async () => {
                trace("start E");
                const record = (name: string) => ({ name, brandId, category: "TOP" as const, priceRange: "MID" as const, affiliateUrl: "https://shop.example.com/imported" });

                // Importer commits first: it needs no token, increments the version, and makes the older browser token stale.
                const first = await createItem("e1");
                assert.equal((await upsertGearItem(record(nameOf("e1")))).action, "updated");
                assert.equal((await read(first)).version, 1);
                await assert.rejects(updateGearItem(first, { name: nameOf("e1-browser") }, { expectedVersion: 0 }), GearItemStaleVersionError);
                assert.equal((await read(first)).name, nameOf("e1"));

                // Tokened commits first; the importer then applies unconditionally (last write wins) and the next old token is stale.
                const second = await createItem("e2");
                await updateGearItem(second, { name: nameOf("e2-browser") }, { expectedVersion: 0 });
                assert.equal((await read(second)).version, 1);
                assert.equal((await upsertGearItem(record(nameOf("e2-browser")))).action, "updated");
                const afterImport = await read(second);
                assert.equal(afterImport.version, 2, "version progressed 0 -> 1 -> 2");
                assert.equal(afterImport.affiliateUrl, "https://shop.example.com/imported", "the importer wrote its complete record");
                await assert.rejects(updateGearItem(second, { name: nameOf("e2-late") }, { expectedVersion: 1 }), GearItemStaleVersionError);

                // Genuinely concurrent: an unconditional writer holds the lock, a tokened one waits and ends up stale.
                const third = await createItem("e3");
                const parked = parkedClient();
                const importerLike = repository.updateGearItem({ id: third, name: nameOf("e3-importer") }, {}, parked.client);
                await within(parked.held.promise, "the holder to take the row lock");
                const browser = settle(updateGearItem(third, { name: nameOf("e3-browser") }, { expectedVersion: 0 }));
                await waitUntilBlocked();
                parked.release.resolve();
                await importerLike;
                assert.ok("error" in (await browser) && (await browser as { error: unknown }).error instanceof GearItemStaleVersionError);
                assert.deepEqual([(await read(third)).name, (await read(third)).version], [nameOf("e3-importer"), 1]);
            });

            await t.test("F. update versus delete, in both commit orders", async () => {
                trace("start F");
                // Delete commits first; the waiting update finds nothing and must not write variants.
                const doomed = await createItem("f1");
                const deleteHeld = deferred();
                const deleteRelease = deferred();
                const deleting = prisma.$transaction(async (tx) => { await tx.gearItem.delete({ where: { id: doomed } }); deleteHeld.resolve(); await deleteRelease.promise; });
                await within(deleteHeld.promise, "the delete to take the row lock");
                const updating = settle(updateGearItem(doomed, { name: nameOf("f1-late"), variants: [{ label: nameOf("F-never"), gender: "men" }] }, { expectedVersion: 0 }));
                await waitUntilBlocked();
                deleteRelease.resolve();
                await deleting;
                const outcome = await updating;
                assert.ok("error" in outcome && outcome.error instanceof GearItemNotFoundError, "classified as not-found, not stale");
                assert.equal(await prisma.gearItem.count({ where: { id: doomed } }), 0);
                assert.equal(await prisma.gearItemVariant.count({ where: { OR: [{ gearItemId: doomed }, { label: nameOf("F-never") }] } }), 0, "no variant row was written by the update");

                // The unconditional path classifies the same way.
                await assert.rejects(updateGearItem(doomed, { name: nameOf("f1-again") }), GearItemNotFoundError);

                // Update commits first; the waiting delete then removes the item (and its variants by cascade).
                const survivor = await createItem("f2");
                const parked = parkedClient();
                const updated = repository.updateGearItem({ id: survivor, name: nameOf("f2-renamed") }, { expectedVersion: 0 }, parked.client);
                await within(parked.held.promise, "the holder to take the row lock");
                const deletion = (async () => prisma.gearItem.delete({ where: { id: survivor } }))();   // Prisma queries are lazy: this must be started, not just built
                await waitUntilBlocked();
                parked.release.resolve();
                const result = await updated;
                await deletion;
                assert.equal((result as { version: number }).version, 1, "the update completed and returned its new version before the delete");
                assert.equal(await prisma.gearItem.count({ where: { id: survivor } }), 0);
                assert.equal(await prisma.gearItemVariant.count({ where: { gearItemId: survivor } }), 0);
            });

            await t.test("G. a writer blocked past Prisma's transaction timeout: what actually happens, and that it is never classified as stale or not-found", async () => {
                trace("start G");
                // For each waiter kind: a holder keeps the row lock, a second writer blocks inside PostgreSQL, and its own 5 s
                // transaction timeout (the production default) elapses while it is still blocked. Only then is the holder released.
                for (const kind of ["tokened", "unconditional"] as const) {
                    const id = await createItem(`g-${kind}`);
                    const parked = parkedClient();
                    const holder = repository.updateGearItem({ id, name: nameOf(`g-${kind}-holder`) }, {}, parked.client);
                    let released = false;
                    const release = () => { if (!released) { released = true; parked.release.resolve(); } };
                    try {
                        await within(parked.held.promise, "the holder to take the row lock");
                        const started = Date.now();
                        let settled = false;
                        const waiter = settle(updateGearItem(id, { name: nameOf(`g-${kind}-waiter`) }, kind === "tokened" ? { expectedVersion: 0 } : {})).then((result) => { settled = true; return result; });
                        await waitUntilBlocked();
                        while (Date.now() - started < 6_000) await new Promise((resolve) => setTimeout(resolve, 50));   // let the waiter's own 5 s timeout elapse

                        const [lockWaiters] = await prisma.$queryRaw<Array<{ n: bigint }>>`select count(*)::bigint as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock'`;
                        t.diagnostic(`[${kind}] 6 s into the wait: caller settled=${settled}, backends still waiting on a lock=${Number(lockWaiters.n)}`);
                        assert.equal(settled, false, "the caller has NOT been released by the 5 s transaction timeout: its statement is still blocked on the row lock");
                        assert.equal(Number(lockWaiters.n), 1, "and PostgreSQL still has that statement waiting");

                        release();
                        await holder;
                        const outcome = await Promise.race([waiter, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the waiter never settled after the lock was released")), 20_000))]);
                        const elapsed = Date.now() - started;
                        assert.ok("error" in outcome, "the blocked writer failed");
                        const error = (outcome as { error: unknown }).error as { name?: string; code?: string; message?: string };
                        t.diagnostic(`[${kind}] settled after ${elapsed} ms: ${error.name} code=${error.code} PrismaClientKnownRequestError=${error instanceof Prisma.PrismaClientKnownRequestError}`);
                        t.diagnostic(`[${kind}] message: ${(error.message ?? "").replace(/\s+/g, " ").slice(0, 170)}`);
                        assert.equal(error instanceof GearItemStaleVersionError, false, "a timeout is never reported as a stale-version conflict");
                        assert.equal(error instanceof GearItemNotFoundError, false, "a timeout is never reported as not-found");

                        await waitUntilNoneBlocked();
                        const row = await read(id);
                        assert.deepEqual([row.name, row.version], [nameOf(`g-${kind}-holder`), 1], "only the lock holder's write is durable; the timed-out waiter wrote nothing");
                        const [open] = await prisma.$queryRaw<Array<{ n: bigint }>>`select count(*)::bigint as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state like 'idle in transaction%'`;
                        assert.equal(Number(open.n), 0, "no transaction was left open by the timed-out writer");
                    } finally {
                        release();
                        await holder.catch(() => undefined);
                    }
                }
            });

            await t.test("H. updatedAt: observed behavior on successful, rejected and contended updates", async () => {
                trace("start H");
                const id = await createItem("h");
                const created = (await read(id)).updatedAt;
                await updateGearItem(id, { name: nameOf("h1") }, { expectedVersion: 0 });
                const afterFirst = (await read(id)).updatedAt;
                assert.ok(afterFirst.getTime() > created.getTime(), "a successful update advances updatedAt");
                await updateGearItem(id, { variants: [{ label: nameOf("h-var"), gender: "men" }] }, { expectedVersion: 1 });
                const afterVariantsOnly = (await read(id)).updatedAt;
                assert.ok(afterVariantsOnly.getTime() > afterFirst.getTime(), "a variants-only update also advances the parent's updatedAt (it is written explicitly)");
                await assert.rejects(updateGearItem(id, { name: nameOf("h-stale") }, { expectedVersion: 0 }), GearItemStaleVersionError);
                assert.equal((await read(id)).updatedAt.getTime(), afterVariantsOnly.getTime(), "a rejected update leaves updatedAt untouched");

                // Diagnostic (not production code): does Prisma's own @updatedAt move on an updateMany that only increments version?
                const before = (await read(id)).updatedAt.getTime();
                await prisma.gearItem.updateMany({ where: { id }, data: { version: { increment: 1 } } });
                const after = (await read(id)).updatedAt.getTime();
                t.diagnostic(`Prisma @updatedAt on updateMany with only a version increment: ${after > before ? "ADVANCED" : "NOT advanced"}`);

                // Contention: the application stamps updatedAt BEFORE the statement waits for the lock, so a writer that is stamped
                // first but reaches the database last leaves an EARLIER updatedAt on the final row.
                const contended = await createItem("h2");
                const stamped = deferred<Date>();
                const gate = deferred();
                const slowClient = {
                    $transaction: <T,>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction(async (tx) => fn({
                        gearItem: {
                            updateMany: async (args: Parameters<typeof tx.gearItem.updateMany>[0]) => { stamped.resolve((args.data as { updatedAt: Date }).updatedAt); await gate.promise; return tx.gearItem.updateMany(args); },
                            findUnique: (args: Parameters<typeof tx.gearItem.findUnique>[0]) => tx.gearItem.findUnique(args),
                        },
                        gearItemVariant: { deleteMany: (args: Parameters<typeof tx.gearItemVariant.deleteMany>[0]) => tx.gearItemVariant.deleteMany(args), createMany: (args: Parameters<typeof tx.gearItemVariant.createMany>[0]) => tx.gearItemVariant.createMany(args) },
                    })),
                } as never;
                const early = repository.updateGearItem({ id: contended, name: nameOf("h2-early") }, {}, slowClient);
                const earlyStamp = await stamped.promise;                       // stamped, but has not reached the database yet
                while (Date.now() <= earlyStamp.getTime()) { /* wait for the clock to pass that millisecond, so the next stamp is strictly later */ }
                await updateGearItem(contended, { name: nameOf("h2-late") });   // stamped later, commits first
                const lateStamp = (await read(contended)).updatedAt;
                gate.resolve();
                await early;                                                     // commits last with its EARLIER stamp
                const final = await read(contended);
                t.diagnostic(`contended updatedAt: later-stamped write ${lateStamp.toISOString()}, final row ${final.updatedAt.toISOString()} (earlier stamp ${earlyStamp.toISOString()})`);
                assert.equal(final.updatedAt.getTime(), earlyStamp.getTime(), "the last commit's own stamp is what is stored");
                assert.ok(final.updatedAt.getTime() < lateStamp.getTime(), "so updatedAt can move BACKWARDS under contention; it is display-only and is never the concurrency token");
                assert.equal(final.version, 2, "while version, the real token, progressed strictly: 0 -> 1 -> 2");
            });

            // Nothing may be left waiting on a lock, and nothing outside this test's marker may have changed.
            await waitUntilNoneBlocked();
            assert.deepEqual(await unrelated(), unrelatedBefore, "unrelated rows are untouched");
        } finally {
            if (verified) {
                // Only this run's own rows: the marker is a fresh random prefix.
                await prisma.gearItem.deleteMany({ where: { name: { startsWith: marker } } });
                await prisma.brand.deleteMany({ where: { name: { startsWith: marker } } });
            }
            await prisma.$disconnect();
        }
    },
);
