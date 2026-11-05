import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { checkTestDatabase } from "../lib/auth/testDatabaseGuard";

/**
 * Lifecycle of the Phase 2C outfit-item constraint migration against REAL PostgreSQL servers. Skipped by default.
 *
 * It needs a server-level connection, because it creates its own throwaway databases (and drops them afterwards):
 *
 *   RUNLAYER_ALLOW_DB_TESTS=1 \
 *   RUNLAYER_TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/runlayer_constraints_test \
 *   npx tsx --test prisma/outfitConstraints.integration.test.ts
 *
 * The URL is checked by lib/auth/testDatabaseGuard.ts (opt-in, local host only, database name contains "test", differs
 * from DATABASE_URL). Every database this test creates is named "<that database>_c2_<random>", so it also contains
 * "test", and only those are dropped. The role must be allowed to CREATE DATABASE. Run it once per server version you
 * care about (for example a PostgreSQL 14 server and a PostgreSQL 17 server); the version is printed as a diagnostic.
 *
 * It also needs the `psql` client (set RUNLAYER_TEST_PSQL to its path if it is not on PATH) because the maintenance
 * scripts are psql scripts. The Prisma CLI is run from a temporary working directory with an explicit DATABASE_URL, so
 * the project's .env is never read.
 *
 * Scope: the duplicate lifecycle (the third subtest) is pinned to the migrations up to and including the Phase 2C migration
 * and builds its fixtures with raw SQL, so it does not depend on anything added later (such as brands.normalized_name).
 * The first two subtests (clean path and schema/migration drift) run against the full, current migration history.
 *
 * What it proves, in order: a clean database migrates; schema and migrations are consistent; duplicate detection and
 * preview are read-only and exact; the migration refuses to run over duplicates and changes nothing; the dedupe script
 * refuses to run unconfirmed, then backs up and removes exactly the right rows; restore reverses it; after remediation
 * the migration succeeds; a raw duplicate is rejected and the real Prisma error maps to the sanitized 409; the new
 * indexes are usable; and a rollback (dropping the indexes) restores the previous index set.
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const check = checkTestDatabase(process.env);
const psqlPath = process.env.RUNLAYER_TEST_PSQL?.trim() || "psql";
const prismaCli = `${root}node_modules/prisma/build/index.js`;
const psqlAvailable = spawnSync(psqlPath, ["--version"], { encoding: "utf8" }).status === 0;
const skipReason = !check.ok ? `skipped: ${check.reason}` : !psqlAvailable ? "skipped: psql was not found (set RUNLAYER_TEST_PSQL)" : !existsSync(prismaCli) ? "skipped: the Prisma CLI was not found" : false;

const MIGRATION_NAME = "20261105180000_add_outfit_item_constraints_and_indexes";
const NEW_INDEXES = ["outfit_items_gear_item_id_idx", "outfit_items_outfit_id_gear_item_id_key", "saved_outfits_user_id_created_at_idx"];

const redact = (text: string) => text.replace(/postgres(ql)?:\/\/[^\s"']+/gi, "<url>");
const withDatabase = (url: string, database: string) => {
    const next = new URL(url);
    next.pathname = `/${database}`;
    return next.toString();
};

test("outfit constraint migration lifecycle against real PostgreSQL", { skip: skipReason }, async (t) => {
    assert.ok(check.ok);
    process.env.DATABASE_URL = check.url; // only so that importing the repository module never sees a hosted URL
    const { mapOutfitWriteError, OutfitValidationError } = await import("@/lib/db/outfitRepository");

    const adminUrl = check.url;
    const adminDatabase = decodeURIComponent(new URL(adminUrl).pathname.replace(/^\//, ""));
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
    const created: string[] = [];
    const workdirs: string[] = [];
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    const clients: PrismaClient[] = [];

    async function createScratchDatabase(label: string) {
        const name = `${adminDatabase}_c2_${label}_${suffix}`.toLowerCase();
        assert.match(name, /^[a-z0-9_]+$/, "database name is a safe identifier");
        assert.match(name, /test/, "scratch database names contain 'test'");
        await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
        created.push(name);
        const url = withDatabase(adminUrl, name);
        const client = new PrismaClient({ datasources: { db: { url } } });
        clients.push(client);
        return { name, url, client };
    }

    // A temp "project" containing the current schema and a chosen subset of the migrations.
    function buildWorkdir(include: (migration: string) => boolean) {
        const dir = mkdtempSync(join(tmpdir(), "runlayer-c2-"));
        workdirs.push(dir);
        mkdirSync(join(dir, "prisma", "migrations"), { recursive: true });
        copyFileSync(`${root}prisma/schema.prisma`, join(dir, "prisma", "schema.prisma"));
        copyFileSync(`${root}prisma/migrations/migration_lock.toml`, join(dir, "prisma", "migrations", "migration_lock.toml"));
        for (const entry of readdirSync(`${root}prisma/migrations`)) {
            if (statSync(`${root}prisma/migrations/${entry}`).isDirectory() && include(entry)) {
                cpSync(`${root}prisma/migrations/${entry}`, join(dir, "prisma", "migrations", entry), { recursive: true });
            }
        }
        return dir;
    }

    function prisma(dir: string, databaseUrl: string, args: string[]) {
        const result = spawnSync(process.execPath, [prismaCli, ...args, "--schema", join(dir, "prisma", "schema.prisma")], {
            cwd: dir,
            env: { ...process.env, DATABASE_URL: databaseUrl, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
            encoding: "utf8",
        });
        return { status: result.status, output: redact(`${result.stdout}\n${result.stderr}`) };
    }

    function psql(databaseUrl: string, script: string, vars: Record<string, string> = {}) {
        const target = new URL(databaseUrl);
        const result = spawnSync(
            psqlPath,
            ["-X", "-q", "-A", "-t", "-F", "|", "-h", target.hostname.replace(/^\[|\]$/g, ""), "-p", target.port || "5432", "-U", decodeURIComponent(target.username), "-d", decodeURIComponent(target.pathname.slice(1)),
                ...Object.entries(vars).flatMap(([key, value]) => ["-v", `${key}=${value}`]), "-f", `${root}prisma/maintenance/${script}`],
            { env: { ...process.env, PGPASSWORD: decodeURIComponent(target.password) }, encoding: "utf8" },
        );
        const lines = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
        return { status: result.status, lines, output: redact(`${result.stdout}\n${result.stderr}`) };
    }

    const md5 = async (client: PrismaClient) =>
        (await client.$queryRawUnsafe<Array<{ h: string | null }>>(`SELECT md5(coalesce(string_agg(id || '/' || outfit_id || '/' || gear_item_id || '/' || coalesce(category::text, '-'), ',' ORDER BY id), '')) AS h FROM outfit_items`))[0].h;
    const indexNames = async (client: PrismaClient) => (await client.$queryRawUnsafe<Array<{ indexname: string }>>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`)).map((row) => row.indexname);
    const countRows = async (client: PrismaClient, table: string) => Number((await client.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${table}"`))[0].n);
    const tableExists = async (client: PrismaClient, table: string) => (await client.$queryRawUnsafe<Array<{ t: string | null }>>(`SELECT to_regclass('public.${table}')::text AS t`))[0].t !== null;

    try {
        const [server] = await admin.$queryRaw<Array<{ version: string; db: string; port: number | null }>>`select current_setting('server_version') as version, current_database() as db, inet_server_port() as port`;
        const target = new URL(adminUrl);
        assert.equal(server.db, adminDatabase, "connected to the intended database");
        assert.equal(Number(server.port), Number(target.port || 5432), "connected to the intended server port");
        t.diagnostic(`PostgreSQL server_version ${server.version}`);
        assert.ok(Number(server.version.split(".")[0]) >= 14, "PostgreSQL 14 or newer");

        await t.test("a clean database migrates through every migration, guard included", async () => {
            const { url, client } = await createScratchDatabase("clean");
            const dir = buildWorkdir(() => true);
            const result = prisma(dir, url, ["migrate", "deploy"]);

            assert.equal(result.status, 0, result.output);
            assert.deepEqual((await indexNames(client)).filter((name) => NEW_INDEXES.includes(name)), NEW_INDEXES);

            const [unique] = await client.$queryRawUnsafe<Array<{ indisunique: boolean }>>(`SELECT i.indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'outfit_items_outfit_id_gear_item_id_key'`);
            assert.equal(unique.indisunique, true);
            const [composite] = await client.$queryRawUnsafe<Array<{ indexdef: string }>>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'saved_outfits_user_id_created_at_idx'`);
            assert.match(composite.indexdef, /\(user_id, created_at DESC\)/);

            const actions = await client.$queryRawUnsafe<Array<{ conname: string; confdeltype: string }>>(`SELECT conname, confdeltype FROM pg_constraint WHERE conname IN ('outfit_items_outfit_id_fkey','outfit_items_gear_item_id_fkey','saved_outfits_user_id_fkey','saved_outfits_recommendation_id_fkey') ORDER BY conname`);
            assert.deepEqual(actions.map((row) => [row.conname, row.confdeltype]), [
                ["outfit_items_gear_item_id_fkey", "c"],
                ["outfit_items_outfit_id_fkey", "c"],
                ["saved_outfits_recommendation_id_fkey", "n"],
                ["saved_outfits_user_id_fkey", "c"],
            ], "cascade behavior is unchanged: c = CASCADE, n = SET NULL");
        });

        await t.test("the Prisma schema and the migrations agree (no drift)", async () => {
            const { url } = await createScratchDatabase("shadow");
            const dir = buildWorkdir(() => true);
            const result = spawnSync(process.execPath, [prismaCli, "migrate", "diff", "--from-migrations", join(dir, "prisma", "migrations"), "--to-schema-datamodel", join(dir, "prisma", "schema.prisma"), "--shadow-database-url", url, "--exit-code"], {
                cwd: dir,
                env: { ...process.env, DATABASE_URL: url, CHECKPOINT_DISABLE: "1" },
                encoding: "utf8",
            });

            assert.equal(result.status, 0, redact(`${result.stdout}\n${result.stderr}`));
        });

        await t.test("duplicates: detection, refusal, remediation, restore, migration, constraint, indexes, rollback", async () => {
            const { name, url, client } = await createScratchDatabase("life");
            const beforeMigrations = buildWorkdir((entry) => entry < MIGRATION_NAME);
            // Through Phase 2C only: later migrations (for example the Phase 2D brand key) add their own indexes and columns, and
            // this lifecycle compares the index set before and after the rollback drill.
            const allMigrations = buildWorkdir((entry) => entry <= MIGRATION_NAME);

            assert.equal(prisma(beforeMigrations, url, ["migrate", "deploy"]).status, 0, "the eight existing migrations apply");
            const indexesBefore = await indexNames(client);
            assert.deepEqual(indexesBefore.filter((index) => NEW_INDEXES.includes(index)), [], "none of the new indexes exist yet");

            // --- Fixtures: three duplicate groups plus legitimate single rows (including the same gear in other outfits).
            const user = await client.user.create({ data: { email: `c2-${suffix}@example.invalid`, passwordHash: "not-a-real-hash" } });
            // Raw SQL, because this database is deliberately at the Phase 2C schema: brands has no normalized_name column yet
            // (the Phase 2D migration adds it later), and the Prisma client now writes that column.
            const brand = { id: `c2-brand-${suffix}` };
            await client.$executeRawUnsafe(`INSERT INTO brands (id, name) VALUES ($1, $1)`, brand.id);
            const gear = await Promise.all(["g1", "g2", "g3"].map((label) => client.gearItem.create({ data: { name: `c2-${label}-${suffix}`, brandId: brand.id, category: "TOP", priceRange: "MID", tags: [], bodyTypeFit: [] } })));
            const outfits = await Promise.all(["o1", "o2", "o3"].map((label) => client.savedOutfit.create({ data: { userId: user.id, name: `c2-${label}-${suffix}`, type: "custom" } })));
            const [g1, g2, g3] = gear.map((item) => item.id);
            const [o1, o2, o3] = outfits.map((item) => item.id);
            await client.outfitItem.createMany({
                data: [
                    { id: "a1", outfitId: o1, gearItemId: g1, category: "TOP" },
                    { id: "a2", outfitId: o1, gearItemId: g1, category: "TOP" }, // duplicate of a1
                    { id: "b1", outfitId: o2, gearItemId: g1, category: null }, // duplicate group of three; b2 survives
                    { id: "b2", outfitId: o2, gearItemId: g1, category: "TOP" },
                    { id: "b3", outfitId: o2, gearItemId: g1, category: "TOP" },
                    { id: "c1", outfitId: o3, gearItemId: g2, category: "TOP" }, // c1 survives (non-null category)
                    { id: "c2", outfitId: o3, gearItemId: g2, category: null },
                    { id: "d1", outfitId: o1, gearItemId: g2, category: "TOP" }, // legitimate singles
                    { id: "d2", outfitId: o2, gearItemId: g2, category: "TOP" },
                    { id: "d3", outfitId: o3, gearItemId: g1, category: "TOP" },
                    { id: "d4", outfitId: o3, gearItemId: g3, category: "TOP" },
                ],
            });
            const original = await md5(client);
            const parentCounts = async () => [await countRows(client, "users"), await countRows(client, "saved_outfits"), await countRows(client, "gear_items"), await countRows(client, "brands")];
            const parents = await parentCounts();

            // --- Detection and preview are exact and read-only.
            const detect = psql(url, "outfit_items_detect_duplicates.sql");
            assert.equal(detect.status, 0, detect.output);
            assert.equal(detect.lines[0], "3|4", "3 duplicate groups, 4 rows would be removed");
            const preview = psql(url, "outfit_items_dedupe_preview.sql");
            assert.equal(preview.status, 0, preview.output);
            const actionsById = Object.fromEntries(preview.lines.map((line) => line.split("|")).filter((fields) => fields.length === 6).map(([, , id, , , action]) => [id, action]));
            assert.deepEqual(actionsById, { a1: "KEEP", a2: "REMOVE", b1: "REMOVE", b2: "KEEP", b3: "REMOVE", c1: "KEEP", c2: "REMOVE" }, "single rows are not listed; the rule keeps non-null categories first");
            assert.equal(await md5(client), original, "detection and preview changed nothing");

            // --- The migration refuses to run over duplicates and leaves the schema alone.
            const refused = prisma(allMigrations, url, ["migrate", "deploy"]);
            assert.notEqual(refused.status, 0, "the guard stops the migration");
            assert.match(refused.output, /duplicate \(outfit_id, gear_item_id\)/, refused.output);
            assert.deepEqual((await indexNames(client)).filter((index) => NEW_INDEXES.includes(index)), [], "no index was created");
            assert.deepEqual(await indexNames(client), indexesBefore, "the index set is exactly as before");
            assert.equal(await md5(client), original, "no data changed");

            const [bookkeeping] = await client.$queryRawUnsafe<Array<{ finished: boolean; rolled_back: boolean }>>(`SELECT (finished_at IS NOT NULL) AS finished, (rolled_back_at IS NOT NULL) AS rolled_back FROM _prisma_migrations WHERE migration_name = '${MIGRATION_NAME}'`);
            t.diagnostic(`failed-migration bookkeeping row present: ${bookkeeping ? `finished=${bookkeeping.finished} rolled_back=${bookkeeping.rolled_back}` : "no row"}`);
            if (bookkeeping && !bookkeeping.finished) {
                const resolved = prisma(allMigrations, url, ["migrate", "resolve", "--rolled-back", MIGRATION_NAME]);
                assert.equal(resolved.status, 0, resolved.output);
            }

            // --- The dedupe script refuses without explicit confirmation.
            const unconfirmed: Array<Record<string, string>> = [{}, { confirm_dedupe: "no" }, { confirm_dedupe: "YES" }];
            for (const vars of unconfirmed) {
                const declined = psql(url, "outfit_items_dedupe.sql", vars);
                assert.match(declined.output, /REFUSING TO RUN/, JSON.stringify(vars));
                assert.equal(await tableExists(client, "outfit_items_dedupe_backup"), false);
                assert.equal(await md5(client), original);
            }

            // --- Remediation: exact backup, exact deletion, nothing else touched.
            const dedupe = psql(url, "outfit_items_dedupe.sql", { confirm_dedupe: "yes" });
            assert.equal(dedupe.status, 0, dedupe.output);
            const backup = await client.$queryRawUnsafe<Array<{ id: string; kept_id: string }>>(`SELECT id, kept_id FROM outfit_items_dedupe_backup ORDER BY id`);
            assert.deepEqual(backup.map((row) => [row.id, row.kept_id]), [["a2", "a1"], ["b1", "b2"], ["b3", "b2"], ["c2", "c1"]]);
            const remaining = (await client.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM outfit_items ORDER BY id`)).map((row) => row.id);
            assert.deepEqual(remaining, ["a1", "b2", "c1", "d1", "d2", "d3", "d4"], "survivors and untouched rows only");
            assert.deepEqual(await parentCounts(), parents, "no parent rows were touched");
            assert.equal(psql(url, "outfit_items_detect_duplicates.sql").lines[0], "0|0", "no duplicates remain");

            const second = psql(url, "outfit_items_dedupe.sql", { confirm_dedupe: "yes" });
            assert.notEqual(second.status, 0, "a second run must not overwrite the backup");
            assert.match(second.output, /already exists/);
            assert.deepEqual((await client.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM outfit_items ORDER BY id`)).map((row) => row.id), remaining, "the refused run changed nothing");

            // --- Restore reverses it exactly; then remediate again from a clean slate.
            const restored = psql(url, "outfit_items_dedupe_restore.sql", { confirm_restore: "yes" });
            assert.equal(restored.status, 0, restored.output);
            assert.equal(await md5(client), original, "restore brings back exactly the original rows");
            await client.$executeRawUnsafe(`DROP TABLE outfit_items_dedupe_backup`);
            assert.equal(psql(url, "outfit_items_dedupe.sql", { confirm_dedupe: "yes" }).status, 0);
            assert.equal(psql(url, "outfit_items_detect_duplicates.sql").lines[0], "0|0");

            // --- Now the migration applies.
            const applied = prisma(allMigrations, url, ["migrate", "deploy"]);
            assert.equal(applied.status, 0, applied.output);
            assert.deepEqual((await indexNames(client)).filter((index) => NEW_INDEXES.includes(index)), NEW_INDEXES);
            assert.deepEqual(await parentCounts(), parents);

            // --- With the unique index in place, restore refuses and a raw duplicate is rejected.
            const afterMigration = await md5(client);
            const refusedRestore = psql(url, "outfit_items_dedupe_restore.sql", { confirm_restore: "yes" });
            assert.notEqual(refusedRestore.status, 0);
            assert.match(refusedRestore.output, /unique index/);
            assert.equal(await md5(client), afterMigration, "the refused restore changed nothing");

            await assert.rejects(
                client.$executeRawUnsafe(`INSERT INTO outfit_items (id, outfit_id, gear_item_id) VALUES ('raw-dup', '${o1}', '${g1}')`),
                (error: unknown) => (error as { meta?: { code?: string } }).meta?.code === "23505" || /23505|duplicate key|unique/i.test(String((error as Error).message)),
                "a raw duplicate insert violates the unique index",
            );

            // The real Prisma error for a duplicate maps to the sanitized 409 (this is what proves the meta.target shape).
            let realError: unknown;
            try {
                await client.outfitItem.create({ data: { outfitId: o1, gearItemId: g1 } });
            } catch (error) {
                realError = error;
            }
            const realMeta = (realError as { code?: string; meta?: { target?: unknown } } | undefined);
            t.diagnostic(`real Prisma duplicate error: code=${realMeta?.code} target=${JSON.stringify(realMeta?.meta?.target)}`);
            assert.equal(realMeta?.code, "P2002");
            const mapped = mapOutfitWriteError(realError);
            assert.ok(mapped instanceof OutfitValidationError, "the real P2002 is recognized");
            assert.deepEqual([(mapped as InstanceType<typeof OutfitValidationError>).statusCode, (mapped as Error).message], [409, "The kit was changed by another request. Please try again."]);
            assert.doesNotMatch((mapped as Error).message, new RegExp(`${o1}|${g1}|outfit_items|outfit_id|gear_item_id|prisma`, "i"));

            // --- The new indexes are usable by the queries they were added for (seqscan disabled so the choice is visible).
            const explain = async (query: string) =>
                client.$transaction(async (tx) => {
                    await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
                    return (await tx.$queryRawUnsafe<Array<Record<string, string>>>(`EXPLAIN ${query}`)).map((row) => Object.values(row)[0]).join("\n");
                });
            assert.match(await explain(`SELECT * FROM saved_outfits WHERE user_id = '${user.id}' ORDER BY created_at DESC`), /saved_outfits_user_id_created_at_idx/);
            assert.match(await explain(`SELECT * FROM outfit_items WHERE gear_item_id = '${g1}'`), /outfit_items_gear_item_id_idx/);
            assert.match(await explain(`SELECT * FROM outfit_items WHERE outfit_id = '${o1}'`), /outfit_items_outfit_id_gear_item_id_key/);

            // --- Rollback drill: dropping the three indexes (what a rollback migration would do) restores the old index set.
            await client.$transaction(async (tx) => {
                for (const index of NEW_INDEXES) await tx.$executeRawUnsafe(`DROP INDEX "${index}"`);
            });
            assert.deepEqual(await indexNames(client), indexesBefore, "the index set is back to the pre-migration state");
            assert.equal(await md5(client), afterMigration, "rolling back the indexes loses no data");
            t.diagnostic(`lifecycle database: ${name.replace(suffix, "<id>")}`);
        });
    } finally {
        await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
        for (const name of created) {
            await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
        }
        await admin.$disconnect();
        for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
    }
});
