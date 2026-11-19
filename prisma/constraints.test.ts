import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * Static (offline) checks for the Phase 2C outfit-item constraint work. They read the Prisma schema, the migration and
 * the maintenance scripts as text. They never connect to a database and never run SQL; the real behavior is covered by
 * the opt-in prisma/outfitConstraints.integration.test.ts.
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

const MIGRATION_NAME = "20261105180000_add_outfit_item_constraints_and_indexes";
const MIGRATION_PATH = `prisma/migrations/${MIGRATION_NAME}/migration.sql`;
const MAINTENANCE = {
    detect: "prisma/maintenance/outfit_items_detect_duplicates.sql",
    preview: "prisma/maintenance/outfit_items_dedupe_preview.sql",
    dedupe: "prisma/maintenance/outfit_items_dedupe.sql",
    restore: "prisma/maintenance/outfit_items_dedupe_restore.sql",
    readme: "prisma/maintenance/README.md",
} as const;

const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
const normalize = (sql: string) => stripSqlComments(sql).replace(/\s+/g, " ").trim();
// Same, with every '...' string literal blanked out, so keyword checks inspect statements and not error-message text.
const statementsOnly = (sql: string) => normalize(sql).replace(/'(?:[^']|'')*'/g, "''");
const MUTATING = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/i;
const model = (schema: string, name: string) => schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";

// --- Prisma schema ------------------------------------------------------------------------------------------------

test("schema: OutfitItem is unique per (outfit, gear item) and indexed by gear item", () => {
    const outfitItem = model(read("prisma/schema.prisma"), "OutfitItem");

    assert.match(outfitItem, /@@unique\(\[outfitId, gearItemId\]\)/);
    assert.match(outfitItem, /@@index\(\[gearItemId\]\)/);
    assert.match(outfitItem, /@@map\("outfit_items"\)/);
});

test("schema: SavedOutfit has the approved composite index and nothing redundant or deferred", () => {
    const schema = read("prisma/schema.prisma");
    const savedOutfit = model(schema, "SavedOutfit");
    const outfitItem = model(schema, "OutfitItem");

    assert.match(savedOutfit, /@@index\(\[userId, createdAt\(sort: Desc\)\]\)/);
    assert.doesNotMatch(savedOutfit, /@@index\(\[userId\]\)/, "a plain user_id index is redundant with the composite");
    assert.doesNotMatch(savedOutfit, /@@index\(\[recommendationId\]\)/, "the recommendation_id index is deferred");
    assert.doesNotMatch(outfitItem, /@@index\(\[outfitId\]\)/, "a plain outfit_id index is redundant with the unique key");
});

test("schema: foreign keys and cascade behavior are unchanged", () => {
    const schema = read("prisma/schema.prisma");
    const savedOutfit = model(schema, "SavedOutfit");
    const outfitItem = model(schema, "OutfitItem");

    assert.match(savedOutfit, /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/);
    assert.match(savedOutfit, /recommendation\s+Recommendation\?\s+@relation\(fields: \[recommendationId\], references: \[id\], onDelete: SetNull\)/);
    assert.match(outfitItem, /outfit\s+SavedOutfit\s+@relation\(fields: \[outfitId\], references: \[id\], onDelete: Cascade\)/);
    assert.match(outfitItem, /gearItem\s+GearItem\s+@relation\(fields: \[gearItemId\], references: \[id\], onDelete: Cascade\)/);
});

test("schema: brand uniqueness is untouched (deferred to a later phase)", () => {
    const brand = model(read("prisma/schema.prisma"), "Brand");

    assert.match(brand, /name\s+String\s+@unique/);
    assert.doesNotMatch(brand, /@@(unique|index)/);
});

// --- Migration ----------------------------------------------------------------------------------------------------

test("migration: it sorts after every migration that existed before it and contains only migration.sql", () => {
    const dir = `${root}prisma/migrations`;
    const names = readdirSync(dir).filter((entry) => statSync(`${dir}/${entry}`).isDirectory()).sort();

    assert.deepEqual(names.filter((name) => name < MIGRATION_NAME), [
        "20260528183058_add_user_roles",
        "20260601163001_add_recommendation_history_feedback",
        "20260602152307_personalization_saved_kits",
        "20260603140249_recommendation_engine_versioning",
        "20260611190351_add_user_profile_location",
        "20260617180201_add_user_profile_gender_preference",
        "20260629195746_add_gear_item_variants",
        "20261104160000_add_user_session_version",
    ], "the eight earlier migrations, all sorting before it (later migrations may follow it)");
    assert.ok(names.includes(MIGRATION_NAME));
    assert.deepEqual(readdirSync(`${dir}/${MIGRATION_NAME}`), ["migration.sql"], "no backup/remediation files inside the migration directory");
});

test("migration: no explicit transaction statements (Prisma would hide the guard message), still atomic as one script", () => {
    const raw = read(MIGRATION_PATH);
    const statements = statementsOnly(raw);

    // With an explicit BEGIN/COMMIT, Prisma reports "current transaction is aborted" instead of the guard's message
    // (observed on PostgreSQL 14 and 17). The script is atomic on its own because Prisma sends it as one multi-statement
    // query. The DO block's own BEGIN/END have no semicolon right after them, so these patterns only match statements.
    assert.doesNotMatch(statements, /\b(BEGIN|COMMIT|ROLLBACK|ABORT|START TRANSACTION|END TRANSACTION)\s*;/i, "no transaction-control statements");
    assert.doesNotMatch(statements, /\bSAVEPOINT\b/i);
    assert.match(raw, /deliberately no explicit\s+-- transaction statement/, "the reason is documented in the file");
});

test("migration: lock timeout, table lock, guard and indexes appear in that order, with the lock timeout pinned", () => {
    const sql = normalize(read(MIGRATION_PATH));
    const at = (pattern: RegExp) => sql.search(pattern);

    assert.ok(sql.startsWith("SET LOCAL lock_timeout = '15s';"), "the 15-second lock timeout is the first statement");
    assert.equal((sql.match(/SET LOCAL lock_timeout/g) ?? []).length, 1);

    const order = [at(/^SET LOCAL lock_timeout = '15s';/), at(/LOCK TABLE "outfit_items" IN SHARE MODE;/), at(/RAISE EXCEPTION/), at(/CREATE INDEX "saved_outfits_user_id_created_at_idx"/), at(/CREATE INDEX "outfit_items_gear_item_id_idx"/), at(/CREATE UNIQUE INDEX "outfit_items_outfit_id_gear_item_id_key"/)];
    assert.ok(order.every((position) => position >= 0), "every expected step is present");
    assert.deepEqual(order, [...order].sort((a, b) => a - b), "lock timeout, lock, guard, then the three indexes - in that order");
    assert.ok(sql.endsWith('("outfit_id", "gear_item_id");'), "the last statement is the unique index");
});

test("migration: the operator-facing guard message is intact", () => {
    const sql = normalize(read(MIGRATION_PATH));

    assert.match(sql, /RAISE EXCEPTION 'outfit_items contains % duplicate \(outfit_id, gear_item_id\) group\(s\); nothing was changed\. Review them and remediate with prisma\/maintenance\/ before applying this migration\.', duplicate_groups;/);
});

test("migration: creates exactly the three approved indexes", () => {
    const sql = normalize(read(MIGRATION_PATH));
    const creates = sql.match(/CREATE (?:UNIQUE )?INDEX [^;]+;/g) ?? [];

    assert.deepEqual(creates, [
        'CREATE INDEX "saved_outfits_user_id_created_at_idx" ON "saved_outfits"("user_id", "created_at" DESC);',
        'CREATE INDEX "outfit_items_gear_item_id_idx" ON "outfit_items"("gear_item_id");',
        'CREATE UNIQUE INDEX "outfit_items_outfit_id_gear_item_id_key" ON "outfit_items"("outfit_id", "gear_item_id");',
    ]);
    assert.doesNotMatch(sql, /IF NOT EXISTS/i, "matches Prisma-generated SQL");
});

test("migration: index names follow Prisma's naming and match the schema declarations", () => {
    const sql = read(MIGRATION_PATH);
    const schema = read("prisma/schema.prisma");

    assert.match(sql, /"saved_outfits_user_id_created_at_idx"/);
    assert.match(sql, /"outfit_items_outfit_id_gear_item_id_key"/);
    assert.match(sql, /"outfit_items_gear_item_id_idx"/);
    assert.match(schema, /@@index\(\[userId, createdAt\(sort: Desc\)\]\)/);
    assert.match(schema, /@@unique\(\[outfitId, gearItemId\]\)/);
});

test("migration: the guard is read-only and the migration never deletes or rewrites data", () => {
    const sql = statementsOnly(read(MIGRATION_PATH));
    const guard = sql.match(/DO \$\$[\s\S]*?\$\$;?/)?.[0] ?? "";

    assert.ok(guard.length > 0, "a guard block exists");
    assert.match(guard, /SELECT count\(\*\) INTO duplicate_groups/);
    assert.match(guard, /GROUP BY "outfit_id", "gear_item_id" HAVING count\(\*\) > 1/);
    assert.match(guard, /IF duplicate_groups > 0 THEN RAISE EXCEPTION/);
    assert.match(normalize(read(MIGRATION_PATH)), /nothing was changed/, "the failure message states that nothing changed");
    assert.doesNotMatch(guard, MUTATING, "the guard only reads");

    const outsideGuard = sql.replace(guard, "");
    assert.doesNotMatch(outsideGuard.replace(/CREATE (UNIQUE )?INDEX/g, ""), MUTATING, "apart from the three CREATE INDEX statements there is no mutating SQL");
    assert.doesNotMatch(statementsOnly(read(MIGRATION_PATH)), /dedupe|backup/i, "no remediation or backup logic inside the migration");
});

// --- Maintenance scripts ------------------------------------------------------------------------------------------

test("maintenance: every script exists outside prisma/migrations", () => {
    for (const path of Object.values(MAINTENANCE)) {
        assert.ok(existsSync(`${root}${path}`), path);
        assert.doesNotMatch(path, /prisma\/migrations\//);
    }
});

test("maintenance: detection and preview are read-only", () => {
    for (const path of [MAINTENANCE.detect, MAINTENANCE.preview]) {
        const sql = statementsOnly(read(path));

        assert.ok(sql.startsWith("BEGIN READ ONLY;"), `${path} opens a READ ONLY transaction`);
        assert.ok(sql.endsWith("ROLLBACK;"), `${path} rolls back`);
        assert.doesNotMatch(sql, MUTATING, `${path} contains no mutating statement`);
        assert.doesNotMatch(sql, /\bCOMMIT\b/i, `${path} never commits`);
    }
});

test("maintenance: the preview labels every row KEEP or REMOVE and ranks exactly like the dedupe script", () => {
    const preview = normalize(read(MAINTENANCE.preview));
    const dedupe = normalize(read(MAINTENANCE.dedupe));
    const ranking = "row_number() OVER (PARTITION BY outfit_id, gear_item_id ORDER BY (category IS NULL), id)";

    assert.match(preview, /'KEEP'/);
    assert.match(preview, /'REMOVE'/);
    assert.ok(preview.includes(ranking), "preview ranking");
    assert.ok(dedupe.includes(ranking), "dedupe ranking is identical");
    assert.ok(preview.includes("count(*) OVER (PARTITION BY outfit_id, gear_item_id) AS copies"));
    assert.ok(dedupe.includes("count(*) OVER (PARTITION BY outfit_id, gear_item_id) AS copies"));
});

test("maintenance: the dedupe script demands explicit confirmation before it opens a transaction", () => {
    const raw = read(MAINTENANCE.dedupe);
    const begin = raw.indexOf("\nBEGIN;");

    assert.match(raw, /\\set ON_ERROR_STOP on/);
    assert.ok(raw.indexOf("\\if :{?confirm_dedupe}") > 0 && raw.indexOf("\\if :{?confirm_dedupe}") < begin, "variable must be present");
    assert.ok(raw.indexOf("(:'confirm_dedupe' = 'yes')") > 0 && raw.indexOf("(:'confirm_dedupe' = 'yes')") < begin, "variable must equal yes");
    assert.equal((raw.match(/\\quit/g) ?? []).length, 2, "both refusal paths quit");
    assert.ok(begin > 0);
});

test("maintenance: the dedupe script backs up before deleting, and deletes only what it backed up", () => {
    const sql = normalize(read(MAINTENANCE.dedupe));
    const create = sql.indexOf("CREATE TABLE outfit_items_dedupe_backup AS");
    const del = sql.indexOf("DELETE FROM outfit_items o");
    const verify = sql.indexOf("dedupe verification failed");
    const commit = sql.lastIndexOf("COMMIT;");

    assert.ok(sql.indexOf("BEGIN;") < sql.indexOf("LOCK TABLE outfit_items IN SHARE ROW EXCLUSIVE MODE"), "locks inside the transaction");
    assert.ok(sql.indexOf("to_regclass('outfit_items_dedupe_backup') IS NOT NULL") > 0, "refuses to overwrite an existing backup");
    assert.ok(sql.indexOf("to_regclass('outfit_items_dedupe_backup') IS NOT NULL") < create);
    assert.ok(create > 0 && create < del && del < verify && verify < commit, "backup, delete, verify, commit - in that order");

    assert.equal((sql.match(/\bDELETE\b/g) ?? []).length, 1, "a single delete");
    assert.match(sql, /DELETE FROM outfit_items o USING outfit_items_dedupe_backup b WHERE o\.id = b\.id;/, "the delete is joined to the backup by id");
    const statements = statementsOnly(read(MAINTENANCE.dedupe));
    assert.doesNotMatch(statements, /\b(DROP|TRUNCATE|ALTER)\b/i, "never drops the backup or any table");
    assert.doesNotMatch(statements, /\bUPDATE\b/i);
    assert.match(sql, /WHERE r\.copies > 1 AND r\.keep_rank > 1/, "only non-survivors of real duplicate groups are backed up");
    assert.match(sql, /k\.keep_rank = 1/, "each backup row records its survivor");
});

test("maintenance: the dedupe script verifies its own result and rolls back on failure", () => {
    const sql = normalize(read(MAINTENANCE.dedupe));

    assert.match(sql, /remaining_groups > 0 OR missing_survivors > 0 OR rows_not_removed > 0 THEN RAISE EXCEPTION/);
    assert.match(sql, /NOT EXISTS \(SELECT 1 FROM outfit_items o WHERE o\.id = b\.kept_id\)/, "every survivor must still exist");
    assert.match(sql, /EXISTS \(SELECT 1 FROM outfit_items o WHERE o\.id = b\.id\)/, "every backed-up row must be gone");
    assert.match(sql, /HAVING count\(\*\) > 1/, "no duplicate group may remain");
});

test("maintenance: the restore script is guarded, additive and refuses once the unique index exists", () => {
    const raw = read(MAINTENANCE.restore);
    const sql = normalize(raw);

    assert.ok(raw.indexOf("\\if :{?confirm_restore}") > 0 && raw.indexOf("\\if :{?confirm_restore}") < raw.indexOf("\nBEGIN;"));
    assert.ok(sql.includes("(:'confirm_restore' = 'yes')"));
    assert.match(sql, /to_regclass\('outfit_items_dedupe_backup'\) IS NULL THEN RAISE EXCEPTION/, "needs a backup");
    assert.match(sql, /indexname = 'outfit_items_outfit_id_gear_item_id_key'\s*\)\s*THEN RAISE EXCEPTION/, "refuses when the unique index exists");
    assert.match(sql, /INSERT INTO outfit_items \(id, outfit_id, gear_item_id, category\) SELECT b\.id, b\.outfit_id, b\.gear_item_id, b\.category FROM outfit_items_dedupe_backup b/, "inserts only backed-up rows");
    assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/, "never overwrites");
    assert.doesNotMatch(statementsOnly(raw), /\b(DELETE|UPDATE|DROP|TRUNCATE|ALTER)\b/i, "purely additive");
});

test("maintenance: the runbook lists the steps in the safe order and keeps hosted runs separately approved", () => {
    const readme = read(MAINTENANCE.readme);
    const positions = ["outfit_items_detect_duplicates.sql", "outfit_items_dedupe_preview.sql", "-v confirm_dedupe=yes", "prisma migrate deploy"].map((needle) => readme.indexOf(`${needle}`, readme.indexOf("### Order of operations")));

    assert.ok(positions.every((position) => position > 0), "all steps are described");
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "detect, preview, remediate, then migrate");
    assert.match(readme, /Back up the database/);
    assert.match(readme, /separate, explicitly approved step/);
    assert.match(readme, /P3009/);
    assert.match(readme, /migrate resolve --rolled-back/);
});

test("maintenance: no file contains a connection string or credential", () => {
    for (const path of [...Object.values(MAINTENANCE), MIGRATION_PATH]) {
        assert.doesNotMatch(read(path), /postgres(ql)?:\/\/|password\s*=|passwd|secret|token/i, path);
    }
});

test("the opt-in lifecycle integration test is gated by the shared local-database guard", () => {
    const source = read("prisma/outfitConstraints.integration.test.ts");

    assert.match(source, /resolveTestDatabase\(process\.env\)/);
    assert.match(source, /const skipReason = !check\.ok \?/, "the skip reason starts from the guard result");
    assert.match(source, /\{ skip: skipReason \}/, "the test is skipped unless every precondition holds");
    assert.match(source, /database name contains "test"|name contains "test"/, "the scratch-database naming rule is documented");
    assert.match(source, /createScratchDatabaseManager\(/, "scratch databases come from the verified manager");
    assert.match(source, /scratch\.finish\(\)/, "it cleans up (and reports on) the databases it created");
    assert.doesNotMatch(source, /\$executeRawUnsafe\(`(?:DROP|CREATE) DATABASE/, "no raw database creation or deletion in the suite itself");
    assert.doesNotMatch(source, /spawnSync\(process\.execPath/, "the Prisma CLI is run only through runPrismaCli");
    const assignments = [...source.matchAll(/process\.env\.DATABASE_URL\s*=\s*([^;]+);/g)].map((match) => match[1].trim());
    assert.ok(assignments.length >= 1, "it pins the app's DATABASE_URL to the test URL");
    assert.ok(assignments.every((value) => value.startsWith("check.url")), "DATABASE_URL is only ever set to the guarded test URL");
});

test("the Phase 2C lifecycle test is pinned to the Phase 2C schema and does not depend on the Phase 2D brand key", () => {
    const source = read("prisma/outfitConstraints.integration.test.ts");
    const code = source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");

    assert.doesNotMatch(code, /normalized_?[nN]ame|toBrandIdentity|brandResolution/, "no reference to the Phase 2D column or code");
    assert.doesNotMatch(code, /client\.brand\.(create|createMany|upsert)/, "the historical brand fixture is raw SQL, not the Prisma client");
    assert.match(code, /INSERT INTO brands \(id, name\) VALUES \(\$1, \$1\)/, "raw SQL compatible with the schema before Phase 2D");
    assert.match(code, /const beforeMigrations = buildWorkdir\(\(entry\) => entry < MIGRATION_NAME\)/, "the starting schema is everything BEFORE the Phase 2C migration");
    assert.match(code, /const allMigrations = buildWorkdir\(\(entry\) => entry <= MIGRATION_NAME\)/, "the lifecycle applies migrations only THROUGH Phase 2C, so later index additions cannot disturb its comparisons");
    assert.doesNotMatch(code, /const allMigrations = buildWorkdir\(\(\) => true\)/);
});

test("the Phase 2C lifecycle keeps its original assertions (duplicate detection, refusal, atomicity, remediation, restore, uniqueness, rollback)", () => {
    const source = read("prisma/outfitConstraints.integration.test.ts");

    for (const expected of [
        'assert.equal(detect.lines[0], "3|4"',
        "detection and preview changed nothing",
        "the guard stops the migration",
        "no index was created",
        "the index set is exactly as before",
        "no data changed",
        "survivors and untouched rows only",
        "no parent rows were touched",
        "a second run must not overwrite the backup",
        "the refused run changed nothing",
        "restore brings back exactly the original rows",
        "the refused restore changed nothing",
        "a raw duplicate insert violates the unique index",
        "the real P2002 is recognized",
        "the index set is back to the pre-migration state",
        "rolling back the indexes loses no data",
    ]) {
        assert.ok(source.includes(expected), `assertion text missing: ${expected}`);
    }
});

// --- Historical gear fixture (Stage G2-B2-F1) ---------------------------------------------------------------------------------------------
// The Phase 2C lifecycle runs on a database that stops at MIGRATION_NAME, so it lacks columns the CURRENT Prisma client reads and writes
// (gear_items.version, added by 20261118120000_add_gear_item_version, and brands.normalized_name, added by the Phase 2D migration). A Prisma
// `gearItem.create` there fails with "The column `version` does not exist". The fixture therefore inserts gear with raw, parameterized SQL that
// names only columns existing at that migration point. These checks are STATIC and database-free: the historical column set is derived from
// the migration files themselves, so it cannot drift from them. They prove the fixture's shape, not run-time behavior (that needs a live run).

function migrationNamesThrough(last: string): string[] {
    return readdirSync(`${root}prisma/migrations`).filter((entry) => /^\d{14}_/.test(entry) && statSync(`${root}prisma/migrations/${entry}`).isDirectory() && entry <= last).sort();
}

/** The columns of `table` after applying the migrations up to and including `last`, and which of them must be supplied by an INSERT. */
function historicalColumns(table: string, last: string) {
    const columns = new Set<string>();
    const required = new Set<string>();
    for (const name of migrationNamesThrough(last)) {
        const sql = read(`prisma/migrations/${name}/migration.sql`);
        const create = new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(sql);
        for (const line of create?.[1]?.split("\n") ?? []) {
            const column = /^\s+"([A-Za-z_]+)"\s+(.+?),?\s*$/.exec(line);
            if (!column) continue;
            columns.add(column[1] as string);
            if (/NOT NULL/.test(column[2] as string) && !/DEFAULT/.test(column[2] as string)) required.add(column[1] as string);
        }
        for (const alter of sql.matchAll(new RegExp(`ALTER TABLE "${table}"([^;]*);`, "g"))) {
            assert.doesNotMatch(alter[1] as string, /DROP COLUMN|RENAME/, `${name}: this check does not model dropped or renamed columns of ${table}`);
            for (const added of (alter[1] as string).matchAll(/ADD COLUMN\s+"([A-Za-z_]+)"([^,]*)/g)) {
                columns.add(added[1] as string);
                if (/NOT NULL/.test(added[2] as string) && !/DEFAULT/.test(added[2] as string)) required.add(added[1] as string);
            }
        }
    }
    return { columns, required };
}

/** Problems with the historical gear fixture in the lifecycle test's source (comments already stripped); empty means it is sound. */
function inspectHistoricalGearFixture(code: string): string[] {
    const problems: string[] = [];
    const lifecycle = code.slice(Math.max(0, code.indexOf('await t.test("duplicates:')));
    if (/\.(gearItem|brand)\.[A-Za-z]+\(/.test(code)) problems.push("prisma_model_api_used_on_a_historical_schema");

    const inserts = [...code.matchAll(/INSERT INTO gear_items \(([^)]*)\) VALUES \(([^)]*)\)/g)];
    if (inserts.length !== 1) return [...problems, "gear_fixture_missing_or_duplicated"];
    const columns = (inserts[0]?.[1] ?? "").split(",").map((column) => column.trim().replace(/"/g, ""));
    const values = (inserts[0]?.[2] ?? "").split(",").map((value) => value.trim());
    if (columns.length !== values.length) problems.push("column_and_value_counts_differ");
    if (new Set(columns).size !== columns.length) problems.push("duplicate_column");

    const historical = historicalColumns("gear_items", "20261105180000_add_outfit_item_constraints_and_indexes");
    for (const column of columns) if (!historical.columns.has(column)) problems.push(`column_not_in_historical_schema:${column}`);
    for (const column of historical.required) if (!columns.includes(column)) problems.push(`required_column_missing:${column}`);
    if (!/INSERT INTO gear_items \([^)]*\) VALUES \(\$1, \$2, \$3, /.test(code)) problems.push("id_name_and_brand_must_be_bound_parameters");
    if (/INSERT INTO gear_items[^`]*\$\{/.test(code)) problems.push("string_interpolation_in_the_fixture_sql");
    if (!/gear\.map\(\(item\) => client\.\$executeRawUnsafe\(`INSERT INTO gear_items[^`]*`, item\.id, item\.name, brand\.id\)\)/.test(code)) problems.push("fixture_values_not_bound");

    const brandInsert = lifecycle.indexOf("INSERT INTO brands (id, name) VALUES ($1, $1)");
    const gearInsert = lifecycle.indexOf("INSERT INTO gear_items");
    if (brandInsert < 0 || gearInsert < brandInsert) problems.push("the_brand_row_must_exist_before_the_gear_rows");
    return problems;
}

test("the Phase 2C lifecycle's gear fixture is raw, parameterized SQL naming only columns that exist at its migration point", () => {
    const code = read("prisma/outfitConstraints.integration.test.ts").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    assert.deepEqual(inspectHistoricalGearFixture(code), []);

    // The point of the fixture: the migrations AFTER its stopping point add columns the current client writes, so the Prisma API cannot be used.
    const atFixture = historicalColumns("gear_items", "20261105180000_add_outfit_item_constraints_and_indexes");
    const atHead = historicalColumns("gear_items", "99999999999999_head");
    assert.equal(atFixture.columns.has("version"), false, "gear_items.version does not exist at the fixture's migration point");
    assert.equal(atHead.columns.has("version"), true, "but it does in the current migrations, which is why the Prisma client cannot create gear there");
    assert.deepEqual([...atFixture.required].sort(), ["brand_id", "category", "id", "name", "priceRange"], "the NOT NULL columns without defaults that every insert must supply");
    const modelColumns = /model GearItem \{([\s\S]*?)\n\}/.exec(read("prisma/schema.prisma"))?.[1] ?? "";
    assert.match(modelColumns, /\n\s+version\s+Int\s+@default\(0\)/, "the current Prisma GearItem model includes version");
});

test("the historical gear fixture inspection has teeth: reintroducing the Prisma API or an unavailable column is detected", () => {
    const code = read("prisma/outfitConstraints.integration.test.ts").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    const insert = 'INSERT INTO gear_items (id, name, brand_id, category, "priceRange", tags, body_type_fit) VALUES ($1, $2, $3,';
    assert.ok(code.includes(insert), "the expected statement is present");
    const mutated: Array<[string, string, string]> = [
        ["the Prisma API again", `${code}\nawait client.gearItem.create({ data: {} });`, "prisma_model_api_used_on_a_historical_schema"],
        ["a column from a later migration", code.replace('"priceRange", tags,', '"priceRange", version, tags,'), "column_not_in_historical_schema:version"],
        ["a missing required column", code.replace("id, name, brand_id, category,", "id, name, category,"), "required_column_missing:brand_id"],
        ["interpolated values", code.replace("VALUES ($1, $2, $3, 'TOP'", "VALUES ($1, $2, ${3}, 'TOP'"), "string_interpolation_in_the_fixture_sql"],
        ["no fixture at all", code.replace(/await Promise\.all\(gear\.map[^\n]*\n/, ""), "gear_fixture_missing_or_duplicated"],
        ["the gear before the brand", code.replace("INSERT INTO brands (id, name) VALUES ($1, $1)", "INSERT INTO brands (id, name) VALUES ($1, $1) /* moved */").replace(/(const brand = [^\n]*\n)\s*await client\.\$executeRawUnsafe\(`INSERT INTO brands[^\n]*\n/, "$1"), "the_brand_row_must_exist_before_the_gear_rows"],
    ];
    for (const [label, source, problem] of mutated) assert.ok(inspectHistoricalGearFixture(source).includes(problem), `${label}: expected ${problem}, got ${inspectHistoricalGearFixture(source).join(", ") || "nothing"}`);
});

test("the Phase 2C lifecycle keeps its scenario: same migration scope, same maintenance scripts, same Prisma operations, no fewer assertions", () => {
    const code = read("prisma/outfitConstraints.integration.test.ts");
    const lifecycle = code.slice(code.indexOf('await t.test("duplicates:'));
    // Counts recorded when the fixture was corrected; the correction itself adds and removes none. Fewer would mean an assertion was dropped.
    assert.ok((lifecycle.match(/assert\./g) ?? []).length >= 44, "assertions in the lifecycle subtest");
    assert.ok((lifecycle.match(/psql\(/g) ?? []).length >= 10, "maintenance-script runs in the lifecycle subtest");
    assert.ok((lifecycle.match(/prisma\(/g) ?? []).length >= 4, "Prisma CLI operations in the lifecycle subtest");
    for (const expected of ['["migrate", "deploy"]', '["migrate", "resolve", "--rolled-back", MIGRATION_NAME]', "outfit_items_detect_duplicates.sql", "outfit_items_dedupe_preview.sql", "outfit_items_dedupe.sql", "outfit_items_dedupe_restore.sql", "confirm_dedupe", "confirm_restore", "NEW_INDEXES", "client.user.create", "client.savedOutfit.create", "client.outfitItem.createMany"]) {
        assert.ok(lifecycle.includes(expected), `missing from the lifecycle: ${expected}`);
    }
    assert.ok(lifecycle.includes("const [g1, g2, g3] = gear.map((item) => item.id);"), "the fixture still hands the same three gear ids to the scenario");
});
