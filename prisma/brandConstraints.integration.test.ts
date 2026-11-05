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
import { isBrandUniqueConflict } from "../lib/db/brandErrors";
import { auditBrands } from "../lib/ingestion/brandKeyAudit";
import { normalizeBrandKey } from "../lib/ingestion/brandResolution";
import { resolveImportBrands } from "../lib/ingestion/brandStore";
import { sqlBackfillKey } from "../lib/ingestion/brandKeyAudit";

/**
 * Brand identity (brands.normalized_name) against REAL PostgreSQL servers. Skipped by default; prepared, not yet run.
 *
 * It needs a server-level connection, because it creates its own throwaway databases (and drops them afterwards):
 *
 *   RUNLAYER_ALLOW_DB_TESTS=1 \
 *   RUNLAYER_TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/runlayer_brands_test \
 *   npx tsx --test prisma/brandConstraints.integration.test.ts
 *
 * The URL is checked by lib/auth/testDatabaseGuard.ts (opt-in, local host only, database name contains "test", differs
 * from DATABASE_URL). Every database this test creates is named "<that database>_br_<label>_<random>", so it also contains
 * "test", and only those are dropped. The role must be allowed to CREATE DATABASE. Run it once per server version (for
 * example PostgreSQL 14 and 17); the version is printed as a diagnostic.
 *
 * It also needs the `psql` client (set RUNLAYER_TEST_PSQL to its path if it is not on PATH) for the read-only maintenance
 * scripts. The Prisma CLI is run from a temporary working directory with an explicit DATABASE_URL, so the project's .env
 * is never read.
 *
 * What it proves, in order: a clean database migrates and ends in the documented state; schema and migrations agree (and,
 * as a NON-asserting diagnostic, whether Prisma reports a candidate CHECK constraint as drift); the read-only census,
 * exact audit and merge preview agree and change nothing; the migration refuses duplicates, non-ASCII, control-character,
 * blank and over-long names with the message visible through Prisma, changing nothing and recording the failure; recovery
 * through `migrate resolve` works; after the data is fixed the migration applies, preserves every id and display name, and
 * stores exactly the key the application computes; uniqueness, NOT NULL and the foreign key behave; concurrent creators of
 * equivalent names end with one row; the new index is usable; and a rollback restores the previous shape.
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const check = checkTestDatabase(process.env);
const psqlPath = process.env.RUNLAYER_TEST_PSQL?.trim() || "psql";
const prismaCli = `${root}node_modules/prisma/build/index.js`;
const psqlAvailable = spawnSync(psqlPath, ["--version"], { encoding: "utf8" }).status === 0;
const skipReason = !check.ok ? `skipped: ${check.reason}` : !psqlAvailable ? "skipped: psql was not found (set RUNLAYER_TEST_PSQL)" : !existsSync(prismaCli) ? "skipped: the Prisma CLI was not found" : false;

const MIGRATION_NAME = "20261105200000_add_brand_normalized_name";

const redact = (text: string) => text.replace(/postgres(ql)?:\/\/[^\s"']+/gi, "<url>");
const withDatabase = (url: string, database: string) => {
    const next = new URL(url);
    next.pathname = `/${database}`;
    return next.toString();
};

// Small, fixed PRNG so the corpus is identical on every run and every server.
function mulberry32(seed: number) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test("brand identity migration against real PostgreSQL", { skip: skipReason }, async (t) => {
    assert.ok(check.ok);
    process.env.DATABASE_URL = check.url; // only so that importing the repository module never sees a hosted URL
    const { createBrand } = await import("@/lib/db/brandRepository");

    const adminUrl = check.url;
    const adminDatabase = decodeURIComponent(new URL(adminUrl).pathname.replace(/^\//, ""));
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
    const created: string[] = [];
    const workdirs: string[] = [];
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    const clients: PrismaClient[] = [];

    async function createScratchDatabase(label: string) {
        const name = `${adminDatabase}_br_${label}_${suffix}`.toLowerCase();
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
        const dir = mkdtempSync(join(tmpdir(), "runlayer-br-"));
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

    function prisma(dir: string, databaseUrl: string, args: string[], withSchema = true) {
        const result = spawnSync(process.execPath, [prismaCli, ...args, ...(withSchema ? ["--schema", join(dir, "prisma", "schema.prisma")] : [])], {
            cwd: dir,
            env: { ...process.env, DATABASE_URL: databaseUrl, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
            encoding: "utf8",
        });
        return { status: result.status, output: redact(`${result.stdout}\n${result.stderr}`) };
    }

    function psql(databaseUrl: string, script: string) {
        const target = new URL(databaseUrl);
        const result = spawnSync(
            psqlPath,
            ["-X", "-q", "-A", "-t", "-F", "|", "-v", "ON_ERROR_STOP=1", "-h", target.hostname.replace(/^\[|\]$/g, ""), "-p", target.port || "5432", "-U", decodeURIComponent(target.username), "-d", decodeURIComponent(target.pathname.slice(1)), "-f", `${root}prisma/maintenance/${script}`],
            { env: { ...process.env, PGPASSWORD: decodeURIComponent(target.password) }, encoding: "utf8" },
        );
        return { status: result.status, lines: result.stdout.split("\n").map((line) => line.trim()).filter(Boolean), output: redact(`${result.stdout}\n${result.stderr}`) };
    }

    const md5 = async (client: PrismaClient, sql: string) => (await client.$queryRawUnsafe<Array<{ h: string | null }>>(sql))[0].h;
    const brandsDigest = (client: PrismaClient) => md5(client, `SELECT md5(coalesce(string_agg(id || '/' || name, ',' ORDER BY id), '')) AS h FROM brands`);
    const gearDigest = (client: PrismaClient) => md5(client, `SELECT md5(coalesce(string_agg(id || '/' || brand_id || '/' || name, ',' ORDER BY id), '')) AS h FROM gear_items`);
    const columnPresent = async (client: PrismaClient) => Number((await client.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'brands' AND column_name = 'normalized_name'`))[0].n) === 1;
    const indexNames = async (client: PrismaClient) => (await client.$queryRawUnsafe<Array<{ indexname: string }>>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`)).map((row) => row.indexname);
    const brandColumns = async (client: PrismaClient) => (await client.$queryRawUnsafe<Array<{ column_name: string }>>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'brands' ORDER BY column_name`)).map((row) => row.column_name);
    // The PostgreSQL error code of a failed raw statement: Prisma's meta.code, else the "Code: `23505`" in its message.
    const sqlState = (error: unknown) => (error as { meta?: { code?: string } }).meta?.code ?? String((error as Error).message ?? "").match(/Code: `([0-9A-Z]{5})`/)?.[1];

    const insertBrand = (client: PrismaClient, id: string, name: string) => client.$executeRawUnsafe(`INSERT INTO brands (id, name) VALUES ($1, $2)`, id, name);
    const insertGear = (client: PrismaClient, id: string, name: string, brandId: string) =>
        client.$executeRawUnsafe(`INSERT INTO gear_items (id, name, brand_id, category, "priceRange", tags, body_type_fit) VALUES ($1, $2, $3, 'TOP', 'MID', '{}', '{}')`, id, name, brandId);

    try {
        const [server] = await admin.$queryRaw<Array<{ version: string; db: string; port: number | null }>>`select current_setting('server_version') as version, current_database() as db, inet_server_port() as port`;
        const target = new URL(adminUrl);
        assert.equal(server.db, adminDatabase, "connected to the intended database");
        assert.equal(Number(server.port), Number(target.port || 5432), "connected to the intended server port");
        t.diagnostic(`PostgreSQL server_version ${server.version}`);
        assert.ok(Number(server.version.split(".")[0]) >= 14, "PostgreSQL 14 or newer");

        await t.test("a clean database migrates and ends in the documented state; foreign keys and cascades are unchanged", async () => {
            const { url, client } = await createScratchDatabase("clean");
            const result = prisma(buildWorkdir(() => true), url, ["migrate", "deploy"]);
            assert.equal(result.status, 0, result.output);

            const [column] = await client.$queryRawUnsafe<Array<{ data_type: string; is_nullable: string }>>(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'brands' AND column_name = 'normalized_name'`);
            assert.deepEqual(column, { data_type: "text", is_nullable: "NO" });

            const uniques = await client.$queryRawUnsafe<Array<{ indexname: string; indisunique: boolean }>>(`SELECT c.relname AS indexname, i.indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname IN ('brands_name_key', 'brands_normalized_name_key') ORDER BY 1`);
            assert.deepEqual(uniques, [{ indexname: "brands_name_key", indisunique: true }, { indexname: "brands_normalized_name_key", indisunique: true }], "the exact-name unique key is kept and the normalized key is added");

            const actions = await client.$queryRawUnsafe<Array<{ conname: string; confdeltype: string }>>(`SELECT conname, confdeltype FROM pg_constraint WHERE conname IN ('gear_items_brand_id_fkey','outfit_items_outfit_id_fkey','outfit_items_gear_item_id_fkey','saved_outfits_user_id_fkey','saved_outfits_recommendation_id_fkey') ORDER BY conname`);
            assert.deepEqual(actions.map((row) => [row.conname, row.confdeltype]), [
                ["gear_items_brand_id_fkey", "r"],
                ["outfit_items_gear_item_id_fkey", "c"],
                ["outfit_items_outfit_id_fkey", "c"],
                ["saved_outfits_recommendation_id_fkey", "n"],
                ["saved_outfits_user_id_fkey", "c"],
            ], "r = RESTRICT (brand to gear), c = CASCADE, n = SET NULL: all unchanged");
        });

        await t.test("the Prisma schema and the migrations agree (no drift); a candidate CHECK constraint is recorded as a diagnostic", async () => {
            const shadow = await createScratchDatabase("shadow");
            const dir = buildWorkdir(() => true);
            const diff = spawnSync(process.execPath, [prismaCli, "migrate", "diff", "--from-migrations", join(dir, "prisma", "migrations"), "--to-schema-datamodel", join(dir, "prisma", "schema.prisma"), "--shadow-database-url", shadow.url, "--exit-code"], {
                cwd: dir,
                env: { ...process.env, DATABASE_URL: shadow.url, CHECKPOINT_DISABLE: "1" },
                encoding: "utf8",
            });
            assert.equal(diff.status, 0, redact(`${diff.stdout}\n${diff.stderr}`));

            // Experiment (never asserted): does Prisma report a CHECK constraint on a live database as drift?
            const live = await createScratchDatabase("check");
            assert.equal(prisma(dir, live.url, ["migrate", "deploy"]).status, 0);
            const fromLive = () => spawnSync(process.execPath, [prismaCli, "migrate", "diff", "--from-url", live.url, "--to-schema-datamodel", join(dir, "prisma", "schema.prisma"), "--exit-code"], {
                cwd: dir,
                env: { ...process.env, DATABASE_URL: live.url, CHECKPOINT_DISABLE: "1" },
                encoding: "utf8",
            });
            assert.equal(fromLive().status, 0, "baseline: a live database that matches the schema reports no difference (the method works)");

            await live.client.$executeRawUnsafe(`ALTER TABLE brands ADD CONSTRAINT brands_normalized_name_shape_check CHECK (normalized_name <> '' AND char_length(normalized_name) <= 100 AND normalized_name = btrim(normalized_name) AND position('  ' in normalized_name) = 0)`);
            const withCheck = fromLive();
            t.diagnostic(`candidate CHECK constraint: prisma migrate diff exit code ${withCheck.status} (0 = not reported as drift, 2 = reported as drift); first output line: ${redact(`${withCheck.stdout}${withCheck.stderr}`).split("\n").find((line) => line.trim()) ?? "(none)"}`);
        });

        await t.test("lifecycle: census, exact audit and preview agree and change nothing; each guard refuses with a visible message; recovery; migration; keys; uniqueness; rollback", async () => {
            const { url, client } = await createScratchDatabase("life");
            const pre = buildWorkdir((entry) => entry < MIGRATION_NAME);
            const full = buildWorkdir(() => true);
            assert.equal(prisma(pre, url, ["migrate", "deploy"]).status, 0, "the earlier migrations apply");
            const columnsBefore = await brandColumns(client);
            const indexesBefore = await indexNames(client);
            assert.equal(columnsBefore.includes("normalized_name"), false);

            // --- Fixtures: two duplicate groups (Nike/nike, Expntl variants) with gear, so repointing would conflict.
            await insertBrand(client, "b1", "Nike");
            await insertBrand(client, "b2", "nike");
            await insertBrand(client, "b3", "Brooks");
            await insertBrand(client, "b4", "Expntl  Athletics");
            await insertBrand(client, "b5", "Expntl Athletics");
            await insertGear(client, "g1", "Run Top", "b1");
            await insertGear(client, "g2", "Run Top", "b2");
            await insertGear(client, "g3", "Tempo Short", "b3");
            const brandsOriginal = await brandsDigest(client);
            const gearOriginal = await gearDigest(client);

            // --- Census (approximate), exact audit (application key) and preview: consistent, and read-only.
            const census = psql(url, "brands_detect_duplicates.sql");
            assert.equal(census.status, 0, census.output);
            assert.equal(census.lines[0], "5|0|2|2", "5 brands, 0 unsupported names, 2 duplicate groups, 2 brands would have to merge");

            const rows = await client.$queryRawUnsafe<Array<{ id: string; name: string }>>(`SELECT id, name FROM brands`);
            const gearRows = (await client.$queryRawUnsafe<Array<{ brand_id: string; name: string }>>(`SELECT brand_id, name FROM gear_items`)).map((row) => ({ brandId: row.brand_id, name: row.name }));
            const audit = auditBrands(rows, gearRows);
            assert.deepEqual(audit.collisionGroups.map((group) => [group.key, group.brands.map((member) => member.id)]), [["expntl athletics", ["b4", "b5"]], ["nike", ["b1", "b2"]]], "the exact audit finds the same groups as the census");
            assert.deepEqual(audit.collisionGroups.find((group) => group.key === "nike")?.gearNameConflicts, ["Run Top"]);
            assert.deepEqual(audit.unsupportedForSqlBackfill, []);

            const preview = psql(url, "brands_merge_preview.sql");
            assert.equal(preview.status, 0, preview.output);
            const actions = Object.fromEntries(preview.lines.map((line) => line.split("|")).filter((fields) => fields.length === 5).map(([, id, , , action]) => [id, action]));
            assert.deepEqual(actions, { b1: "KEEP (canonical)", b2: "MERGE INTO b1", b4: "KEEP (canonical)", b5: "MERGE INTO b4" }, "most gear, then oldest, then smallest id");
            assert.ok(preview.lines.some((line) => line.startsWith("nike|Run Top|")), "the gear-name conflict is listed as a blocker");
            assert.equal(await brandsDigest(client), brandsOriginal, "census, audit and preview changed no brand");
            assert.equal(await gearDigest(client), gearOriginal, "...and no gear item");

            // --- Guard 2: duplicates stop the migration, with the message visible through Prisma, and change nothing.
            const refused = prisma(full, url, ["migrate", "deploy"]);
            assert.notEqual(refused.status, 0);
            assert.match(refused.output, /2 group\(s\) of names that normalize to the same key/, refused.output);
            assert.equal(await columnPresent(client), false, "the column and the backfill were rolled back too");
            assert.deepEqual(await brandColumns(client), columnsBefore);
            assert.deepEqual(await indexNames(client), indexesBefore);
            assert.equal(await brandsDigest(client), brandsOriginal);
            assert.equal(await gearDigest(client), gearOriginal);

            const [bookkeeping] = await client.$queryRawUnsafe<Array<{ finished: boolean; rolled_back: boolean; log_chars: number }>>(`SELECT (finished_at IS NOT NULL) AS finished, (rolled_back_at IS NOT NULL) AS rolled_back, coalesce(length(logs), 0)::int AS log_chars FROM _prisma_migrations WHERE migration_name = '${MIGRATION_NAME}'`);
            t.diagnostic(`failed-migration bookkeeping: ${bookkeeping ? `finished=${bookkeeping.finished} rolled_back=${bookkeeping.rolled_back} log_chars=${bookkeeping.log_chars}` : "no row"}`);
            assert.ok(bookkeeping && !bookkeeping.finished && !bookkeeping.rolled_back, "the failure is recorded");
            assert.match(prisma(full, url, ["migrate", "deploy"]).output, /P3009/, "further migrations are refused until the failure is resolved");
            assert.equal(prisma(full, url, ["migrate", "resolve", "--rolled-back", MIGRATION_NAME]).status, 0);

            // --- The operator resolves the duplicates by hand (there is deliberately no merge script): rename the twins.
            await client.$executeRawUnsafe(`UPDATE brands SET name = 'Nike Two' WHERE id = 'b2'`);
            await client.$executeRawUnsafe(`UPDATE brands SET name = 'Expntl Athletics Two' WHERE id = 'b5'`);

            // --- Guard 1: every kind of name the SQL backfill cannot key exactly is refused, one at a time.
            const unsupported: Array<[label: string, name: string]> = [
                ["non-ASCII", "Café"],
                ["control character", "tab\there"],
                ["blank", "   "],
                ["key longer than 100", "x".repeat(101)],
            ];
            for (const [label, badName] of unsupported) {
                await insertBrand(client, "bad", badName);
                const digestWithBad = await brandsDigest(client);
                const attempt = prisma(full, url, ["migrate", "deploy"]);

                assert.notEqual(attempt.status, 0, label);
                assert.match(attempt.output, /1 name\(s\) that are not printable ASCII, are blank, or produce a key longer than 100 characters; nothing was changed/, `${label}: ${attempt.output}`);
                assert.match(attempt.output, /prisma\/maintenance\/README\.md/, `${label}: the message points to the documented path`);
                assert.equal(await columnPresent(client), false, `${label}: nothing was added`);
                assert.equal(await brandsDigest(client), digestWithBad, `${label}: nothing was changed`);

                const census2 = psql(url, "brands_detect_duplicates.sql");
                assert.match(census2.lines.join("\n"), /^bad\|/m, `${label}: the census lists it`);
                assert.equal(prisma(full, url, ["migrate", "resolve", "--rolled-back", MIGRATION_NAME]).status, 0, label);
                await client.$executeRawUnsafe(`DELETE FROM brands WHERE id = 'bad'`);
            }

            // --- Everything is clean now: the migration applies, preserving every id and display name.
            const idsAndNamesBefore = await brandsDigest(client);
            const applied = prisma(full, url, ["migrate", "deploy"]);
            assert.equal(applied.status, 0, applied.output);
            assert.equal(await brandsDigest(client), idsAndNamesBefore, "every brand id and display name is preserved");
            assert.equal(await gearDigest(client), gearOriginal, "gear still points at the same brands");

            const stored = await client.$queryRawUnsafe<Array<{ id: string; name: string; normalized_name: string }>>(`SELECT id, name, normalized_name FROM brands ORDER BY id`);
            for (const row of stored) {
                assert.equal(row.normalized_name, normalizeBrandKey(row.name), `${row.id}: stored key equals the application's key`);
                assert.equal(row.normalized_name, sqlBackfillKey(row.name), `${row.id}: ...and the JavaScript copy of the SQL expression`);
            }
            const verifier = auditBrands(stored.map((row) => ({ id: row.id, name: row.name, storedKey: row.normalized_name })));
            assert.deepEqual(verifier.storedKeyMismatches, [], "the read-only verifier finds no mismatch");
            assert.match(prisma(full, url, ["migrate", "status"]).output, /up to date/i);

            // --- Uniqueness, NOT NULL, exact-name uniqueness and the foreign key.
            await assert.rejects(insertBrand2(client, "dup", "Another Display Name", "nike"), (error: unknown) => sqlState(error) === "23505", "a second brand with the same key is rejected by PostgreSQL");
            await assert.rejects(insertBrand(client, "nokey", "No Key Brand"), (error: unknown) => sqlState(error) === "23502", "a writer that forgets the key fails loudly");
            await assert.rejects(insertBrand2(client, "dupname", "Brooks", "brooks-other"), (error: unknown) => sqlState(error) === "23505", "the exact-name unique key still applies");
            await assert.rejects(client.$executeRawUnsafe(`DELETE FROM brands WHERE id = 'b1'`), (error: unknown) => sqlState(error) === "23503", "a brand with gear cannot be deleted (RESTRICT)");

            let realError: unknown;
            try {
                await client.brand.create({ data: { name: "Brand With A Taken Key", normalizedName: "nike" } });
            } catch (error) {
                realError = error;
            }
            const realMeta = realError as { code?: string; meta?: { target?: unknown } } | undefined;
            t.diagnostic(`real Prisma duplicate-key error: code=${realMeta?.code} target=${JSON.stringify(realMeta?.meta?.target)}`);
            assert.equal(realMeta?.code, "P2002");
            assert.equal(isBrandUniqueConflict(realError), true, "the real error is recognized as a brand race");

            // --- The lookup index is usable (availability, not the planner's choice on a tiny table).
            const plan = await client.$transaction(async (tx) => {
                await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
                return (await tx.$queryRawUnsafe<Array<Record<string, string>>>(`EXPLAIN SELECT * FROM brands WHERE normalized_name = 'nike'`)).map((row) => Object.values(row)[0]).join("\n");
            });
            assert.match(plan, /brands_normalized_name_key/);

            // --- Rollback drill: drop the index and the column (what a rollback migration would do).
            await client.$transaction(async (tx) => {
                await tx.$executeRawUnsafe(`DROP INDEX "brands_normalized_name_key"`);
                await tx.$executeRawUnsafe(`ALTER TABLE "brands" DROP COLUMN "normalized_name"`);
            });
            assert.deepEqual(await brandColumns(client), columnsBefore, "the column set is back to the pre-migration state");
            assert.deepEqual(await indexNames(client), indexesBefore, "...and so is the index set");
            assert.equal(await brandsDigest(client), idsAndNamesBefore, "rolling back loses no id or display name");
            assert.equal(await gearDigest(client), gearOriginal);
        });

        await t.test("the SQL backfill equals the application key on real PostgreSQL for a seeded corpus, end to end through the migration", async () => {
            const { url, client } = await createScratchDatabase("ascii");
            assert.equal(prisma(buildWorkdir((entry) => entry < MIGRATION_NAME), url, ["migrate", "deploy"]).status, 0);

            const random = mulberry32(20261105);
            const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_&.,'()";
            const names: string[] = ["Nike", "  Padded  ", "ALL CAPS", "a  b   c", " x ", "Expntl   Athletics"].map((name, index) => `${name}${index === 0 ? "" : ` #${index}`}`);
            for (let index = 0; index < 600; index += 1) {
                let name = `B${index} `;
                for (let position = 0; position < 1 + Math.floor(random() * 30); position += 1) {
                    const roll = random();
                    name += roll < 0.2 ? " ".repeat(1 + Math.floor(random() * 4)) : letters[Math.floor(random() * letters.length)];
                }
                names.push(`${" ".repeat(Math.floor(random() * 3))}${name}${" ".repeat(Math.floor(random() * 3))}`);
            }
            const unique = [...new Map(names.map((name) => [normalizeBrandKey(name), name])).values()];
            for (const [index, name] of unique.entries()) await insertBrand(client, `a${index}`, name);

            assert.equal(prisma(buildWorkdir(() => true), url, ["migrate", "deploy"]).status, 0, "the migration applies to the whole corpus");
            const stored = await client.$queryRawUnsafe<Array<{ name: string; normalized_name: string }>>(`SELECT name, normalized_name FROM brands`);
            assert.equal(stored.length, unique.length);
            for (const row of stored) assert.equal(row.normalized_name, normalizeBrandKey(row.name), JSON.stringify(row.name));

            // Observations that justify not re-implementing the key in SQL (diagnostics only; nothing is asserted).
            const probe = async (label: string, sql: string) => {
                try {
                    t.diagnostic(`${label}: ${JSON.stringify(await client.$queryRawUnsafe(sql), (_k, value) => (typeof value === "bigint" ? Number(value) : value))}`);
                } catch (error) {
                    t.diagnostic(`${label}: error ${sqlState(error) ?? (error as Error).name}`);
                }
            };
            await probe("server_encoding / lc_ctype", `SELECT current_setting('server_encoding') AS enc, (SELECT datctype FROM pg_database WHERE datname = current_database()) AS lc_ctype`);
            await probe("normalize() exists and its volatility (i = immutable)", `SELECT provolatile FROM pg_proc WHERE proname = 'normalize' LIMIT 1`);
            await probe("lower(dotted capital I + stanbul) code points", `SELECT array_agg(ascii(c)) AS cps FROM regexp_split_to_table(lower(U&'\\0130stanbul'), '') AS c`);
            await probe("lower(Greek final sigma word) last code point", `SELECT ascii(right(lower(U&'\\039F\\0394\\039F\\03A3'), 1)) AS last_cp`);
            await probe("no-break space matches \\s", `SELECT (U&'a\\00A0b' ~ '\\s') AS matches`);
        });

        await t.test("concurrent creators of equivalent names end with exactly one brand, through the admin path and the importer path", async () => {
            const { url, client } = await createScratchDatabase("conc");
            assert.equal(prisma(buildWorkdir(() => true), url, ["migrate", "deploy"]).status, 0);

            for (let round = 0; round < 20; round += 1) {
                const base = `race${round}`;
                const variants = [base, base.toUpperCase(), ` ${base} `, base.replace("race", "RaCe"), `${base}  `, base.replace("race", "ｒａｃｅ")];
                const results = await Promise.all([
                    ...variants.slice(0, 4).map((name) => createBrand({ name }, client)),
                    ...variants.slice(4).map((name) => resolveImportBrands([{ id: null, name }], client)),
                ]);

                const ids = results.map((result) => (Array.isArray(result) ? (result[0] as { brandId: string }).brandId : (result as { id: string }).id));
                assert.equal(new Set(ids).size, 1, `round ${round}: every caller got the same brand id`);
                assert.equal(Number((await client.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM brands WHERE normalized_name = $1`, normalizeBrandKey(base)))[0].n), 1, `round ${round}: exactly one row`);
            }

            // A second, equivalent request returns the existing brand and does not rewrite its display name.
            const first = await createBrand({ name: "Display Keeper" }, client);
            const again = await createBrand({ name: "  DISPLAY   KEEPER ", tier: "premium" }, client);
            assert.equal(again.id, first.id);
            assert.equal(again.name, "Display Keeper");
            assert.equal(again.tier, "premium");
        });
    } finally {
        await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
        for (const name of created) {
            await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
        }
        await admin.$disconnect();
        for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
    }

    // Inserts a post-migration brand row WITH an explicit key.
    function insertBrand2(client: PrismaClient, id: string, name: string, key: string) {
        return client.$executeRawUnsafe(`INSERT INTO brands (id, name, normalized_name) VALUES ($1, $2, $3)`, id, name, key);
    }
});
