import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkTestDatabase } from "../auth/testDatabaseGuard";
import { BRAND_FAILURE, toBrandIdentity } from "./brandResolution";
import { resolveImportBrands } from "./brandStore";
import { importGear } from "./importGear";
import { parseGearJsonFiles } from "./parsers/jsonGearParser";

/**
 * Catalog import against a REAL PostgreSQL database. Skipped by default; NOT part of the offline suite's coverage.
 *
 * To run it, point it at a dedicated, throwaway local database whose schema is already migrated (this test never
 * applies migrations and never touches DATABASE_URL's database):
 *
 *   RUNLAYER_ALLOW_DB_TESTS=1 \
 *   RUNLAYER_TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/runlayer_import_test \
 *   npx tsx --test lib/ingestion/importGear.integration.test.ts
 *
 * Safeguards (lib/auth/testDatabaseGuard.ts): explicit opt-in, local host only, database name must contain "test",
 * and it must differ from DATABASE_URL. Before anything is written the test also asks the server it reached for its
 * database name and port. Every row it creates carries a unique marker prefix and only those rows are deleted.
 * Rows without the marker are counted before and after to prove the import leaves unrelated data alone.
 */
const check = checkTestDatabase(process.env);

test(
    "catalog import against a real PostgreSQL database",
    { skip: check.ok ? false : `skipped: ${check.reason}` },
    async (t) => {
        assert.ok(check.ok);

        // The app's shared Prisma client reads DATABASE_URL when it is first imported, so point it at the test
        // database BEFORE importing it (and the service that uses it).
        process.env.DATABASE_URL = check.url;
        const { prisma } = await import("@/lib/prisma");
        const { updateGearItem } = await import("@/services/gearService");

        const marker = `p2a-${randomUUID().slice(0, 8)}`;
        const dirs: string[] = [];
        const nameOf = (suffix: string) => `${marker}-${suffix}`;
        const brandData = (name: string) => toBrandIdentity(name) as NonNullable<ReturnType<typeof toBrandIdentity>>;

        async function runImport(items: unknown[]) {
            const dir = await mkdtemp(path.join(tmpdir(), "runlayer-import-test-"));
            dirs.push(dir);
            await writeFile(path.join(dir, "catalog.json"), JSON.stringify({ items }));
            return importGear({
                parseItems: () => parseGearJsonFiles(dir),
                resolveBrands: (references) => resolveImportBrands(references, prisma),
            });
        }

        const item = (suffix: string, brand: string, extra: Record<string, unknown> = {}) => ({
            name: nameOf(suffix),
            brand,
            category: "top",
            price: 100,
            ...extra,
        });

        const brandsWithMarker = () => prisma.brand.findMany({ where: { name: { startsWith: marker } }, orderBy: { name: "asc" } });
        const itemsWithMarker = () => prisma.gearItem.findMany({ where: { name: { startsWith: marker } }, include: { variants: true }, orderBy: { name: "asc" } });
        const unrelatedCounts = async () => ({
            brands: await prisma.brand.count({ where: { NOT: { name: { startsWith: marker } } } }),
            items: await prisma.gearItem.count({ where: { NOT: { name: { startsWith: marker } } } }),
        });

        try {
            // Read-only target check before anything is written.
            const target = new URL(check.url);
            const [reached] = await prisma.$queryRaw<Array<{ db: string; port: number | null }>>`select current_database() as db, inet_server_port() as port`;
            assert.equal(reached.db, decodeURIComponent(target.pathname.replace(/^\//, "")), "connected to the intended database");
            assert.equal(Number(reached.port), Number(target.port || 5432), "connected to the intended server port");

            // Unrelated catalog records that must survive every import untouched.
            const sentinelBrand = await prisma.brand.create({ data: brandData(nameOf("sentinel-brand")) });
            const sentinelItem = await prisma.gearItem.create({
                data: {
                    name: nameOf("sentinel-item"),
                    brandId: sentinelBrand.id,
                    category: "TOP",
                    priceRange: "MID",
                    tags: [],
                    bodyTypeFit: [],
                    variants: { create: [{ label: "Custom", gender: "men", sizes: ["M"] }] },
                },
            });
            const snapshotSentinel = async () => JSON.stringify(await prisma.gearItem.findUnique({ where: { id: sentinelItem.id }, include: { variants: true, brand: true } }));
            const sentinelBefore = await snapshotSentinel();
            const unrelatedBefore = await unrelatedCounts();

            await t.test("import into an empty database creates brands, items and default variants", async () => {
                const result = await runImport([item("a", nameOf("nike")), item("b", nameOf("brooks"), { category: "bottom" }), item("c", nameOf("adidas"), { category: "accessory" })]);

                assert.deepEqual(result.failed, []);
                assert.equal(result.inserted, 3);
                assert.equal(result.updated, 0);

                const brands = await brandsWithMarker();
                assert.deepEqual(brands.map((brand) => brand.name).filter((name) => !name.includes("sentinel")), [nameOf("adidas"), nameOf("brooks"), nameOf("nike")], "display names preserved as supplied");

                const items = (await itemsWithMarker()).filter((row) => !row.name.includes("sentinel"));
                assert.equal(items.length, 3);
                for (const row of items) {
                    assert.ok(brands.some((brand) => brand.id === row.brandId), "brand_id is a real brands.id");
                    assert.deepEqual(row.variants.map((variant) => [variant.label, variant.gender]), [["Default", "unisex"]]);
                }
            });

            await t.test("repeating the import updates instead of duplicating", async () => {
                const before = await itemsWithMarker();
                const result = await runImport([item("a", nameOf("nike")), item("b", nameOf("brooks"), { category: "bottom" }), item("c", nameOf("adidas"), { category: "accessory" })]);

                assert.deepEqual(result.failed, []);
                assert.equal(result.inserted, 0);
                assert.equal(result.updated, 3);

                const after = await itemsWithMarker();
                assert.deepEqual(after.map((row) => row.id), before.map((row) => row.id), "same rows, same ids");
                assert.equal((await brandsWithMarker()).length, 4, "no extra brands (3 + sentinel)");
            });

            await t.test("an existing brand is reused case-insensitively", async () => {
                const existing = await prisma.brand.create({ data: brandData(nameOf("Casing")) });
                const result = await runImport([item("casing-item", nameOf("casing"))]);

                assert.deepEqual(result.failed, []);
                const row = await prisma.gearItem.findFirstOrThrow({ where: { name: nameOf("casing-item") } });
                assert.equal(row.brandId, existing.id);
                assert.equal((await prisma.brand.count({ where: { name: { in: [nameOf("Casing"), nameOf("casing")] } } })), 1, "no duplicate brand");
            });

            await t.test("two concurrent imports converge on one brand and one row per item", async () => {
                const catalog = [1, 2, 3, 4, 5].map((n) => item(`conc-${n}`, nameOf(n % 2 ? "conc-x" : "conc-y")));
                const [first, second] = await Promise.all([runImport(catalog), runImport(catalog)]);

                assert.equal(first.inserted + second.inserted, 5, "each item is inserted exactly once across both runs");
                for (const failure of [...first.failed, ...second.failed]) {
                    assert.equal(failure.reason, "conflicting concurrent write", "only the documented conflict may surface, sanitized");
                }
                t.diagnostic(`concurrent run conflicts reported: ${first.failed.length + second.failed.length}`);

                assert.equal((await prisma.brand.findMany({ where: { name: { in: [nameOf("conc-x"), nameOf("conc-y")] } } })).length, 2, "one brand per name");
                const rows = (await itemsWithMarker()).filter((row) => row.name.includes("-conc-"));
                assert.equal(rows.length, 5);
                for (const row of rows) assert.equal(row.variants.length, 1, "variants replaced, never doubled");

                const settle = await runImport(catalog);
                assert.deepEqual(settle.failed, [], "a follow-up run converges cleanly");
                assert.equal(settle.updated, 5);
            });

            await t.test("invalid brand references fail their rows and create nothing", async () => {
                // Two brands whose names are equivalent can no longer be created normally (the database enforces the
                // normalized key). This simulates LEGACY / INCONSISTENT data - rows written before keys existed - by
                // giving them different stored keys, so the importer's ambiguity protection is still exercised.
                await prisma.brand.createMany({
                    data: [
                        { name: nameOf("Twin"), normalizedName: nameOf("twin") },
                        { name: nameOf("TWIN"), normalizedName: `legacy-${nameOf("twin")}` },
                    ],
                });
                const known = await prisma.brand.findFirstOrThrow({ where: { name: nameOf("nike") } });

                const result = await runImport([
                    item("ok", nameOf("nike")),
                    item("bad-id", nameOf("ignored"), { brand: undefined, brandId: "does-not-exist" }),
                    item("conflict", nameOf("brooks"), { brandId: known.id }),
                    item("malformed", 5 as unknown as string),
                    item("ambiguous", nameOf("twin")),
                    item("rejected-new-brand", nameOf("never-created"), { brandId: "nope" }),
                ]);

                assert.deepEqual(
                    Object.fromEntries(result.failed.map((failure) => [failure.name.replace(`${marker}-`, ""), failure.reason])),
                    {
                        malformed: BRAND_FAILURE.invalidName,
                        "bad-id": BRAND_FAILURE.unknownId,
                        conflict: BRAND_FAILURE.conflict,
                        ambiguous: BRAND_FAILURE.ambiguous,
                        "rejected-new-brand": BRAND_FAILURE.unknownId,
                    },
                );
                assert.equal(await prisma.brand.count({ where: { name: { in: [nameOf("never-created"), nameOf("ignored")] } } }), 0, "rejected rows never create brands");
                assert.equal(await prisma.gearItem.count({ where: { name: nameOf("ok") } }), 1, "the valid row still imported");
            });

            await t.test("a re-import replaces admin-added variants, and a failed variant write rolls back", async () => {
                const row = await prisma.gearItem.findFirstOrThrow({ where: { name: nameOf("a") } });
                await prisma.gearItemVariant.create({ data: { gearItemId: row.id, label: "Extra", gender: "women", sizes: [] } });

                await runImport([item("a", nameOf("nike"))]);
                const replaced = await prisma.gearItemVariant.findMany({ where: { gearItemId: row.id } });
                assert.deepEqual(replaced.map((variant) => variant.label), ["Default"], "existing behavior preserved: variants are replaced");

                await assert.rejects(
                    updateGearItem(row.id, { variants: [{ label: "Dup", gender: "men" }, { label: "Dup", gender: "men" }] }),
                    "duplicate variants violate the unique key",
                );
                const afterFailure = await prisma.gearItemVariant.findMany({ where: { gearItemId: row.id } });
                assert.deepEqual(afterFailure.map((variant) => variant.label), ["Default"], "the failed update rolled back; previous variants intact");
            });

            await t.test("a failing row does not stop the rest of the batch", async () => {
                const result = await runImport([item("batch-good", nameOf("nike")), item("batch-bad", nameOf("nike"), { category: "shoes" })]);

                assert.equal(result.failed.length, 1);
                assert.equal(result.failed[0].reason, "invalid category");
                assert.equal(await prisma.gearItem.count({ where: { name: nameOf("batch-good") } }), 1);
                assert.equal(await prisma.gearItem.count({ where: { name: nameOf("batch-bad") } }), 0);
            });

            await t.test("unrelated catalog records are untouched", async () => {
                assert.equal(await snapshotSentinel(), sentinelBefore, "sentinel brand, item and variants are byte-identical");
                assert.deepEqual(await unrelatedCounts(), unrelatedBefore, "no unrelated brands or items were added or removed");
            });
        } finally {
            await prisma.gearItem.deleteMany({ where: { name: { startsWith: marker } } });
            await prisma.brand.deleteMany({ where: { name: { startsWith: marker } } });
            await prisma.$disconnect();
            await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
        }
    },
);
