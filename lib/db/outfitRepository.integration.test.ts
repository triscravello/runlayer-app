import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { checkTestDatabase } from "../auth/testDatabaseGuard";

/**
 * Saved-outfit transactions against a REAL PostgreSQL database. Skipped by default.
 *
 * To run it, point it at a dedicated, throwaway local database whose schema is already migrated (this test never
 * applies migrations and never touches DATABASE_URL's database):
 *
 *   RUNLAYER_ALLOW_DB_TESTS=1 \
 *   RUNLAYER_TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/runlayer_outfit_test \
 *   npx tsx --test lib/db/outfitRepository.integration.test.ts
 *
 * Safeguards (lib/auth/testDatabaseGuard.ts): explicit opt-in, local host only, database name must contain "test",
 * and it must differ from DATABASE_URL. Before anything is written the test also asks the server it reached for its
 * database name and port. Every row it creates carries a unique marker and only those rows are deleted; rows without
 * the marker are counted and snapshotted before and after to prove unrelated records are left alone.
 */
const check = checkTestDatabase(process.env);

test(
    "saved outfit transactions against a real PostgreSQL database",
    { skip: check.ok ? false : `skipped: ${check.reason}` },
    async (t) => {
        assert.ok(check.ok);

        // The app's shared Prisma client reads DATABASE_URL when it is first imported, so point it at the test
        // database BEFORE importing it (and the repository that uses it).
        process.env.DATABASE_URL = check.url;
        const { prisma } = await import("@/lib/prisma");
        const repo = await import("@/lib/db/outfitRepository");
        type Runner = import("@/lib/db/outfitRepository").OutfitTransactionRunner;

        const marker = `p2b-${randomUUID().slice(0, 8)}`;
        const email = (name: string) => `${marker}-${name}@example.invalid`;
        const sortIds = (ids: string[]) => [...ids].sort();

        const itemsOf = async (outfitId: string) => (await prisma.outfitItem.findMany({ where: { outfitId } })).map((item) => item.gearItemId);
        const snapshot = async (outfitId: string) => {
            const row = await prisma.savedOutfit.findUnique({ where: { id: outfitId }, include: { OutfitItem: true } });
            return JSON.stringify(row && { ...row, OutfitItem: sortIds(row.OutfitItem.map((item) => item.gearItemId)) });
        };
        const duplicatePairs = async (outfitId: string) =>
            prisma.$queryRaw<Array<{ gear_item_id: string; n: bigint }>>`SELECT gear_item_id, count(*) AS n FROM outfit_items WHERE outfit_id = ${outfitId} GROUP BY gear_item_id HAVING count(*) > 1`;
        const outfitCount = (userId: string) => prisma.savedOutfit.count({ where: { userId } });
        const unrelatedCounts = async () => ({
            users: await prisma.user.count({ where: { NOT: { email: { startsWith: marker } } } }),
            outfits: await prisma.savedOutfit.count({ where: { NOT: { user: { email: { startsWith: marker } } } } }),
            items: await prisma.outfitItem.count({ where: { NOT: { outfit: { user: { email: { startsWith: marker } } } } } }),
            gear: await prisma.gearItem.count({ where: { NOT: { name: { startsWith: marker } } } }),
        });

        // Wraps the real transaction so that, right before the items are inserted, the victim gear item is deleted
        // INSIDE the same transaction. The insert then fails with a foreign-key error after earlier writes happened.
        const failingRunner = (victimGearId: string): Runner => ({
            $transaction: (fn, options) =>
                prisma.$transaction(async (tx) => {
                    const wrapped = {
                        savedOutfit: tx.savedOutfit,
                        gearItem: tx.gearItem,
                        recommendation: tx.recommendation,
                        $queryRaw: tx.$queryRaw.bind(tx),
                        outfitItem: {
                            deleteMany: (args: Parameters<typeof tx.outfitItem.deleteMany>[0]) => tx.outfitItem.deleteMany(args),
                            createMany: async (args: Parameters<typeof tx.outfitItem.createMany>[0]) => {
                                await tx.gearItem.delete({ where: { id: victimGearId } });
                                return tx.outfitItem.createMany(args);
                            },
                        },
                    };
                    return fn(wrapped as unknown as Parameters<typeof fn>[0]);
                }, options),
        });

        try {
            // Read-only target check before anything is written.
            const target = new URL(check.url);
            const [reached] = await prisma.$queryRaw<Array<{ db: string; port: number | null }>>`select current_database() as db, inet_server_port() as port`;
            assert.equal(reached.db, decodeURIComponent(target.pathname.replace(/^\//, "")), "connected to the intended database");
            assert.equal(Number(reached.port), Number(target.port || 5432), "connected to the intended server port");

            // --- fixtures ---------------------------------------------------------------------------------------
            const [userA, userB, userC] = await Promise.all(["a", "b", "c"].map((name) => prisma.user.create({ data: { email: email(name), passwordHash: "integration-test-not-a-real-hash" } })));
            const brand = await prisma.brand.create({ data: { name: `${marker}-brand` } });
            const gear = await Promise.all(
                [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
                    prisma.gearItem.create({
                        data: { name: `${marker}-gear-${n}`, brandId: brand.id, category: n % 2 ? "TOP" : "BOTTOM", priceRange: "MID", tags: [], bodyTypeFit: [] },
                    }),
                ),
            );
            const g = gear.map((item) => item.id);
            const recA = await prisma.recommendation.create({ data: { userId: userA.id, inputContext: {}, output: {} } });
            const recB = await prisma.recommendation.create({ data: { userId: userB.id, inputContext: {}, output: {} } });

            // An unrelated user's outfit that must survive everything below untouched.
            const sentinel = await prisma.savedOutfit.create({
                data: { userId: userC.id, name: `${marker}-sentinel`, type: "custom", OutfitItem: { create: [{ gearItemId: g[0], category: "TOP" }] } },
            });
            const sentinelBefore = await snapshot(sentinel.id);
            const unrelatedBefore = await unrelatedCounts();

            await t.test("characterization: the ORIGINAL delete-then-insert pattern loses items when the insert fails", async () => {
                // This reproduces the pre-Phase-2B steps (separate statements, no transaction) to document the defect.
                const outfit = await prisma.savedOutfit.create({ data: { userId: userA.id, name: `${marker}-legacy`, type: "custom", OutfitItem: { create: [{ gearItemId: g[0] }, { gearItemId: g[1] }] } } });

                await assert.rejects(async () => {
                    await prisma.outfitItem.deleteMany({ where: { outfitId: outfit.id } });
                    await prisma.outfitItem.createMany({ data: [{ outfitId: outfit.id, gearItemId: `${marker}-does-not-exist` }] });
                });

                assert.deepEqual(await itemsOf(outfit.id), [], "the original pattern leaves the outfit empty after a failed insert");
            });

            await t.test("characterization: the ORIGINAL pattern under concurrency (observational, never asserts a race)", async () => {
                const outfit = await prisma.savedOutfit.create({ data: { userId: userA.id, name: `${marker}-legacy-race`, type: "custom" } });
                const legacyReplace = async (ids: string[]) => {
                    await prisma.outfitItem.deleteMany({ where: { outfitId: outfit.id } });
                    await prisma.outfitItem.createMany({ data: ids.map((gearItemId) => ({ outfitId: outfit.id, gearItemId })) });
                };

                let roundsWithDuplicates = 0;
                for (let round = 0; round < 20; round += 1) {
                    await Promise.all([legacyReplace([g[0], g[1]]), legacyReplace([g[1], g[2]])]);
                    if ((await duplicatePairs(outfit.id)).length > 0) roundsWithDuplicates += 1;
                }
                t.diagnostic(`original pattern: ${roundsWithDuplicates}/20 concurrent rounds produced duplicate items`);
            });

            await t.test("create writes the outfit and its items atomically for the authenticated owner", async () => {
                const created = await repo.saveOutfit({ userId: userA.id, recommendationId: recA.id, name: "Long run", type: "race_day", gearItemIds: [g[0], g[1], g[0]] });

                assert.equal(created.userId, userA.id);
                assert.equal(created.type, "race-day");
                assert.equal(created.recommendationId, recA.id);
                assert.deepEqual(sortIds(created.OutfitItem.map((item) => item.gearItemId)), sortIds([g[0], g[1]]), "duplicates collapsed");
                assert.deepEqual(await duplicatePairs(created.id), []);
            });

            await t.test("a failed create leaves no outfit behind, including when the failure happens mid-transaction", async () => {
                const before = await outfitCount(userA.id);

                await assert.rejects(repo.saveOutfit({ userId: userA.id, gearItemIds: [g[0], `${marker}-does-not-exist`] }), (error: unknown) => error instanceof repo.OutfitValidationError && error.statusCode === 400);
                assert.equal(await outfitCount(userA.id), before, "validation failure wrote nothing");

                const victim = g[7];
                await assert.rejects(
                    repo.saveOutfit({ userId: userA.id, name: "Doomed", gearItemIds: [victim, g[0]] }, failingRunner(victim)),
                    (error: unknown) => error instanceof repo.OutfitValidationError && error.statusCode === 409 && /no longer available/.test(error.message),
                );
                assert.equal(await outfitCount(userA.id), before, "the outfit insert was rolled back with the failed item insert");
                assert.equal(await prisma.gearItem.count({ where: { id: victim } }), 1, "the in-transaction side effect (gear delete) was rolled back too");
            });

            await t.test("a failed update rolls back metadata and items together", async () => {
                const outfit = await repo.saveOutfit({ userId: userA.id, name: "Stable", description: "keep me", gearItemIds: [g[0], g[1]] });
                const before = await snapshot(outfit.id);

                await assert.rejects(repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id, name: "Bad id", gearItemIds: [g[2], `${marker}-does-not-exist`] }), (error: unknown) => error instanceof repo.OutfitValidationError && error.statusCode === 400);
                assert.equal(await snapshot(outfit.id), before, "a bad gear id applied nothing");

                const victim = g[6];
                await assert.rejects(
                    repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id, name: "Half applied?", isFavorite: true, gearItemIds: [victim, g[2]] }, failingRunner(victim)),
                    (error: unknown) => error instanceof repo.OutfitValidationError && error.statusCode === 409,
                );
                assert.equal(await snapshot(outfit.id), before, "name, favorite flag and items are all restored after a mid-transaction failure");
                assert.equal(await prisma.gearItem.count({ where: { id: victim } }), 1);
            });

            await t.test("updatedAt advances for real changes, stays put for no-ops, and is rolled back with a failed update", async () => {
                const wait = () => new Promise((resolve) => setTimeout(resolve, 25)); // keep timestamps strictly apart
                const stamp = async (id: string) => (await prisma.savedOutfit.findUniqueOrThrow({ where: { id } })).updatedAt.getTime();
                const outfit = await repo.saveOutfit({ userId: userA.id, name: "Stamp", description: "d", type: "trail", gearItemIds: [g[0], g[1]] });
                const itemRowIds = async () => (await prisma.outfitItem.findMany({ where: { outfitId: outfit.id }, orderBy: { id: "asc" } })).map((item) => item.id);

                const created = await stamp(outfit.id);

                await wait();
                await repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id, gearItemIds: [g[2], g[3]] });
                const afterItems = await stamp(outfit.id);
                assert.ok(afterItems > created, "an item-only update advances updatedAt");
                assert.deepEqual(sortIds(await itemsOf(outfit.id)), sortIds([g[2], g[3]]));

                await wait();
                await repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id, name: "Renamed" });
                const afterMetadata = await stamp(outfit.id);
                assert.ok(afterMetadata > afterItems, "a metadata update advances updatedAt");

                // No-ops: nothing supplied, then values that already match (items in a different order, repeated ids).
                const rowsBefore = await itemRowIds();
                await wait();
                await repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id });
                await repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id, name: "Renamed", description: "d", type: "trail", isFavorite: false });
                await repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id, gearItemIds: [g[3], g[2], g[3]] });
                assert.equal(await stamp(outfit.id), afterMetadata, "no-op updates preserve updatedAt");
                assert.deepEqual(await itemRowIds(), rowsBefore, "no-op updates rewrite no item rows");

                // A failed update (foreign-key failure after the timestamp was written) restores the old timestamp.
                const victim = g[7];
                const before = await snapshot(outfit.id);
                await wait();
                await assert.rejects(
                    repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id, name: "Doomed", gearItemIds: [victim, g[4]] }, failingRunner(victim)),
                    (error: unknown) => error instanceof repo.OutfitValidationError && error.statusCode === 409,
                );
                assert.equal(await stamp(outfit.id), afterMetadata, "a failed update leaves updatedAt unchanged");
                assert.equal(await snapshot(outfit.id), before, "...along with every other column and the items");
            });

            await t.test("concurrent updates with different gear sets end in exactly one of the sets, never a mixture or duplicates", async () => {
                const setA = [g[0], g[1], g[2]];
                const setB = [g[3], g[4]];
                const setC = [g[5], g[1], g[4], g[6]];
                const outfit = await repo.saveOutfit({ userId: userA.id, name: "Contended", gearItemIds: [g[0]] });
                const winners = { A: 0, B: 0, C: 0 };
                const startedAt = (await prisma.savedOutfit.findUniqueOrThrow({ where: { id: outfit.id } })).updatedAt.getTime();

                for (let round = 0; round < 20; round += 1) {
                    await Promise.all([
                        repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id, gearItemIds: setA }),
                        repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id, gearItemIds: setB }),
                        repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id, gearItemIds: setC }),
                    ]);

                    const final = sortIds(await itemsOf(outfit.id));
                    const matches = (["A", "B", "C"] as const).filter((key) => JSON.stringify(final) === JSON.stringify(sortIds({ A: setA, B: setB, C: setC }[key])));
                    assert.equal(matches.length, 1, `round ${round}: final items must equal exactly one writer's set, got ${final.length} rows`);
                    winners[matches[0]] += 1;
                    assert.deepEqual(await duplicatePairs(outfit.id), [], `round ${round}: no duplicate items`);
                }
                t.diagnostic(`last writer per round: ${JSON.stringify(winners)}`);
                assert.ok((await prisma.savedOutfit.findUniqueOrThrow({ where: { id: outfit.id } })).updatedAt.getTime() > startedAt, "updatedAt advanced across the contended updates");
            });

            await t.test("repeated gear ids never create duplicate rows", async () => {
                const outfit = await repo.saveOutfit({ userId: userA.id, gearItemIds: [g[0]] });
                const updated = await repo.updateSavedOutfit({ userId: userA.id, outfitId: outfit.id, gearItemIds: [g[1], g[1], g[2], g[1]] });

                assert.equal(updated?.OutfitItem.length, 2);
                assert.deepEqual(await duplicatePairs(outfit.id), []);
            });

            await t.test("another user cannot read, update, delete or attach to a user's outfit or recommendation", async () => {
                const outfit = await repo.saveOutfit({ userId: userA.id, recommendationId: recA.id, name: "Private", gearItemIds: [g[0], g[1]] });
                const before = await snapshot(outfit.id);
                const bBefore = await outfitCount(userB.id);

                assert.equal(await repo.getSavedOutfitById(userB.id, outfit.id), null);
                assert.equal(await repo.updateSavedOutfit({ userId: userB.id, outfitId: outfit.id, name: "Hijacked", gearItemIds: [g[5]] }), null);
                assert.equal((await repo.deleteSavedOutfitById(userB.id, outfit.id)).count, 0);
                assert.ok(!(await repo.listSavedOutfitsByUserId(userB.id)).some((row) => row.id === outfit.id));
                await assert.rejects(repo.saveOutfit({ userId: userB.id, recommendationId: recA.id, gearItemIds: [g[0]] }), (error: unknown) => error instanceof repo.OutfitValidationError && error.statusCode === 404);

                assert.equal(await snapshot(outfit.id), before, "the owner's outfit is byte-identical after every attempt");
                assert.equal(await outfitCount(userB.id), bBefore, "the rejected attempt created nothing for the other user");

                const own = await repo.saveOutfit({ userId: userB.id, recommendationId: recB.id, gearItemIds: [g[0]] });
                assert.equal(own.recommendationId, recB.id, "a user can still attach their own recommendation");
            });

            await t.test("deleting an outfit removes only its items; deleting a gear item removes only its outfit items", async () => {
                const keep = await repo.saveOutfit({ userId: userA.id, name: "Keeper", gearItemIds: [g[2], g[3]] });
                const doomed = await repo.saveOutfit({ userId: userA.id, name: "Doomed", gearItemIds: [g[2], g[3]] });

                assert.equal((await repo.deleteSavedOutfitById(userA.id, doomed.id)).count, 1);
                assert.deepEqual(await itemsOf(doomed.id), []);
                assert.equal(await prisma.gearItem.count({ where: { id: { in: [g[2], g[3]] } } }), 2, "gear items survive an outfit delete");
                assert.equal((await itemsOf(keep.id)).length, 2, "another outfit's items are untouched");

                const extra = await prisma.gearItem.create({ data: { name: `${marker}-gear-extra`, brandId: brand.id, category: "TOP", priceRange: "MID", tags: [], bodyTypeFit: [] } });
                const withExtra = await repo.saveOutfit({ userId: userA.id, name: "Has extra", gearItemIds: [g[2], extra.id] });
                await prisma.gearItem.delete({ where: { id: extra.id } });

                assert.deepEqual(await itemsOf(withExtra.id), [g[2]], "only the deleted gear's outfit item disappeared");
                assert.equal(await prisma.savedOutfit.count({ where: { id: withExtra.id } }), 1, "the outfit itself remains");
            });

            await t.test("deleting a recommendation detaches it from outfits without deleting them", async () => {
                const rec = await prisma.recommendation.create({ data: { userId: userA.id, inputContext: {}, output: {} } });
                const outfit = await repo.saveOutfit({ userId: userA.id, recommendationId: rec.id, gearItemIds: [g[0]] });

                await prisma.recommendation.delete({ where: { id: rec.id } });
                const after = await prisma.savedOutfit.findUniqueOrThrow({ where: { id: outfit.id } });
                assert.equal(after.recommendationId, null);
            });

            await t.test("unrelated records are untouched", async () => {
                assert.equal(await snapshot(sentinel.id), sentinelBefore, "the unrelated user's outfit and items are byte-identical");
                assert.deepEqual(await unrelatedCounts(), unrelatedBefore, "no unrelated users, outfits, items or gear were added or removed");
            });
        } finally {
            await prisma.user.deleteMany({ where: { email: { startsWith: marker } } });
            await prisma.gearItem.deleteMany({ where: { name: { startsWith: marker } } });
            await prisma.brand.deleteMany({ where: { name: { startsWith: marker } } });
            await prisma.$disconnect();
        }
    },
);
