import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * Static (offline) checks for the Phase 2D brand-identity work. They read the Prisma schema, the migration, the
 * maintenance files and the application source as text. They never connect to a database and never run SQL; the real
 * behavior is covered by the opt-in prisma/brandConstraints.integration.test.ts.
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

const MIGRATION_NAME = "20261105200000_add_brand_normalized_name";
const MIGRATION_PATH = `prisma/migrations/${MIGRATION_NAME}/migration.sql`;

const stripSqlComments = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
const normalize = (sql: string) => stripSqlComments(sql).replace(/\s+/g, " ").trim();
// Same, with every '...' string literal blanked out, so keyword checks inspect statements and not message text.
const statementsOnly = (sql: string) => normalize(sql).replace(/'(?:[^']|'')*'/g, "''");
const MUTATING = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/i;
const model = (schema: string, name: string) => schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(`${root}${path}`)).digest("hex");

// --- Earlier migration history is untouched -----------------------------------------------------------------------

test("earlier migrations are byte-for-byte unchanged", () => {
    const expected: Record<string, string> = {
        "20260528183058_add_user_roles": "73efe816161934b0cacc5fbe3d91f69b07cfb1de41cf68219ea7733a177ae368",
        "20260601163001_add_recommendation_history_feedback": "f228d08035799e1247bdf7fbc74adcb2bf3878472bb622faedbaeb7835bd6ee5",
        "20260602152307_personalization_saved_kits": "6bcc69bc1cd4d160a663f8328ffccd8fdabaf114e4c01edb1a37582287ee42c7",
        "20260603140249_recommendation_engine_versioning": "0270ac112fc6efc9e67671b13dac363df7680b0abe4313f81f32d40d9d43d3b0",
        "20260611190351_add_user_profile_location": "d81b43f026aec2d890ce35a038ccd49a054d6bb1e7a7d377601fef7a6391adda",
        "20260617180201_add_user_profile_gender_preference": "43bb1bb87b23b28e87b8690ebefe7b2afa9c67e06975dada332defb924c0f807",
        "20260629195746_add_gear_item_variants": "0a73d58b375525d070a76bb8f24f4f328b79818465b69cbefac78d3e1c32b9fd",
        "20261104160000_add_user_session_version": "113af74ca32ad869f5558649b4b87bbbff0cddc847b8a48d232ff133f55cfce5",
        "20261105180000_add_outfit_item_constraints_and_indexes": "c9cc1c11210f320f2a34707b212831f1ce80eb77c962920117d281f064965b32",
    };

    for (const [name, hash] of Object.entries(expected)) {
        assert.equal(sha256(`prisma/migrations/${name}/migration.sql`), hash, `${name} was modified; applied migrations are immutable`);
    }
});

test("the brand migration is the newest and sits alone in its directory", () => {
    const dir = `${root}prisma/migrations`;
    const names = readdirSync(dir).filter((entry) => statSync(`${dir}/${entry}`).isDirectory()).sort();

    assert.equal(names.at(-1), MIGRATION_NAME);
    assert.deepEqual(readdirSync(`${dir}/${MIGRATION_NAME}`), ["migration.sql"]);
});

// --- Prisma schema ------------------------------------------------------------------------------------------------

test("schema: brands keep their unique name and gain a required, unique, mapped normalized key", () => {
    const brand = model(read("prisma/schema.prisma"), "Brand");

    assert.match(brand, /name\s+String\s+@unique/, "the exact-name unique constraint is kept");
    assert.match(brand, /normalizedName\s+String\s+@unique\s+@map\("normalized_name"\)/, "required, unique, snake_case column");
    assert.match(brand, /id\s+String\s+@id\s+@default\(uuid\(\)\)/, "ids are untouched");
    assert.doesNotMatch(brand, /@@(unique|index)/, "no compound or extra indexes");
    assert.match(brand, /@@map\("brands"\)/);
});

test("schema: the brand foreign key and gear uniqueness are unchanged", () => {
    const schema = read("prisma/schema.prisma");
    const gear = model(schema, "GearItem");

    assert.match(gear, /brand\s+Brand\s+@relation\(fields: \[brandId\], references: \[id\]\)/, "no onDelete override: the default (restrict) stays");
    assert.match(gear, /@@unique\(\[name, brandId\]\)/);
});

// --- Migration ----------------------------------------------------------------------------------------------------

test("migration: no explicit transaction statements, so Prisma shows the guard messages", () => {
    const statements = statementsOnly(read(MIGRATION_PATH));

    assert.doesNotMatch(statements, /\b(BEGIN|COMMIT|ROLLBACK|ABORT|START TRANSACTION|END TRANSACTION|SAVEPOINT)\s*;/i);
    assert.match(read(MIGRATION_PATH), /deliberately no explicit transaction statement/, "the reason is documented in the file");
});

test("migration: exactly these top-level statements, in this order", () => {
    const withoutGuards = normalize(read(MIGRATION_PATH)).replace(/DO \$\$[\s\S]*?\$\$;/g, "DO_BLOCK;");
    const statements = withoutGuards.split(";").map((statement) => statement.trim()).filter(Boolean);

    assert.deepEqual(statements, [
        "SET LOCAL lock_timeout = '15s'",
        'LOCK TABLE "brands" IN ACCESS EXCLUSIVE MODE',
        "DO_BLOCK",
        'ALTER TABLE "brands" ADD COLUMN "normalized_name" TEXT',
        `UPDATE "brands" SET "normalized_name" = translate( regexp_replace(btrim("name"), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz' )`.replace(/\s+/g, " "),
        "DO_BLOCK",
        'ALTER TABLE "brands" ALTER COLUMN "normalized_name" SET NOT NULL',
        'CREATE UNIQUE INDEX "brands_normalized_name_key" ON "brands"("normalized_name")',
    ].map((statement) => statement.replace(/\s+/g, " ")));
});

test("migration: guards come first, are read-only, and the constraints are enforced only after backfill and validation", () => {
    const sql = normalize(read(MIGRATION_PATH));
    const at = (pattern: RegExp) => sql.search(pattern);
    const order = [
        at(/^SET LOCAL lock_timeout/),
        at(/LOCK TABLE "brands"/),
        at(/RAISE EXCEPTION 'brands contains % name\(s\)/), // guard 1: unsupported names
        at(/ADD COLUMN "normalized_name" TEXT;/),
        at(/UPDATE "brands" SET "normalized_name"/),
        at(/RAISE EXCEPTION 'brands contains % group\(s\)/), // guard 2: collisions
        at(/SET NOT NULL/),
        at(/CREATE UNIQUE INDEX "brands_normalized_name_key"/),
    ];

    assert.ok(order.every((position) => position >= 0), "every step is present");
    assert.deepEqual(order, [...order].sort((a, b) => a - b), "lock timeout, lock, guard 1, add column, backfill, guard 2, NOT NULL, unique index");

    const guards = sql.match(/DO \$\$[\s\S]*?\$\$;/g) ?? [];
    assert.equal(guards.length, 2);
    for (const guard of guards) assert.doesNotMatch(statementsOnly(guard), MUTATING, "a guard only reads");
});

test("migration: guard 1 refuses exactly what the SQL backfill cannot key exactly", () => {
    const sql = normalize(read(MIGRATION_PATH));

    assert.match(sql, /octet_length\("name"\) <> char_length\("name"\)/, "non-ASCII");
    assert.match(sql, /"name" ~ '\[\[:cntrl:\]\]'/, "control characters");
    assert.match(sql, /btrim\("name"\) = ''/, "blank");
    assert.match(sql, /char_length\(regexp_replace\(btrim\("name"\), ' \+', ' ', 'g'\)\) > 100/, "over-long key");
    assert.match(sql, /not printable ASCII, are blank, or produce a key longer than 100 characters; nothing was changed/);
    assert.match(sql, /prisma\/maintenance\/README\.md/, "the message points the operator at the JavaScript backfill");
});

test("migration: the backfill is locale-independent and writes only the new column", () => {
    const statements = statementsOnly(read(MIGRATION_PATH));
    const sql = normalize(read(MIGRATION_PATH));

    assert.doesNotMatch(statements, /\blower\s*\(/i, "no lower(): it depends on the database locale");
    assert.doesNotMatch(statements, /\bupper\s*\(/i);
    assert.doesNotMatch(statements, /\bnormalize\s*\(/i, "no SQL re-implementation of Unicode normalization");
    assert.doesNotMatch(statements, /\\s|\[\[:space:\]\]/, "no locale-dependent whitespace class");
    assert.match(sql, /translate\( ?regexp_replace\(btrim\("name"\), ' \+', ' ', 'g'\), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz' ?\)/);

    const updates = sql.match(/\bUPDATE\b[^;]*;/gi) ?? [];
    assert.equal(updates.length, 1, "a single UPDATE");
    assert.match(updates[0], /^UPDATE "brands" SET "normalized_name" = /, "it assigns only normalized_name");
    assert.doesNotMatch(updates[0], /\bWHERE\b/i, "every row is keyed (the guard has already ruled out unsupported names)");
    assert.equal((updates[0].match(/ = /g) ?? []).length, 1, "one assignment, no other column");
});

test("migration: never deletes, merges, renames or touches other tables; no CHECK constraint yet", () => {
    const statements = statementsOnly(read(MIGRATION_PATH));

    assert.doesNotMatch(statements, /\b(DELETE|DROP|TRUNCATE|RENAME)\b/i);
    assert.doesNotMatch(statements, /\bINSERT\b/i);
    assert.doesNotMatch(statements, /\b(gear_items|user_profiles|saved_outfits|outfit_items|recommendations)\b/i);
    assert.doesNotMatch(statements, /\bCHECK\b/i, "CHECK constraints are deferred until Prisma drift behavior is verified");
    assert.doesNotMatch(statements, /\bSET "name"|"id" =/i, "names and ids are never rewritten");
    assert.doesNotMatch(statements, /dedupe|backup|merge/i, "remediation lives outside the migration");
});

test("migration: its end state is exactly what the Prisma schema describes", () => {
    const sql = normalize(read(MIGRATION_PATH));

    assert.match(sql, /ADD COLUMN "normalized_name" TEXT;/);
    assert.match(sql, /ALTER COLUMN "normalized_name" SET NOT NULL;/);
    assert.match(sql, /CREATE UNIQUE INDEX "brands_normalized_name_key" ON "brands"\("normalized_name"\);/, "Prisma's own name for @unique on normalized_name");
});

// --- Maintenance tooling ------------------------------------------------------------------------------------------

test("maintenance: brand detection and merge preview are read-only", () => {
    for (const path of ["prisma/maintenance/brands_detect_duplicates.sql", "prisma/maintenance/brands_merge_preview.sql"]) {
        const sql = statementsOnly(read(path));

        assert.ok(sql.startsWith("BEGIN READ ONLY;"), `${path} opens a READ ONLY transaction`);
        assert.ok(sql.endsWith("ROLLBACK;"), `${path} rolls back`);
        assert.doesNotMatch(sql, MUTATING, `${path} contains no mutating statement`);
        assert.doesNotMatch(sql, /\bCOMMIT\b/i);
    }
});

test("maintenance: the SQL census uses the migration's expression for printable ASCII and covers every requested finding", () => {
    const detect = normalize(read("prisma/maintenance/brands_detect_duplicates.sql"));
    const preview = normalize(read("prisma/maintenance/brands_merge_preview.sql"));
    const expression = "translate(regexp_replace(btrim(name), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')";

    assert.ok(detect.includes(expression) && preview.includes(expression), "the same key expression as the migration");
    assert.match(detect, /not ASCII/, "unsupported names");
    assert.match(detect, /GROUP BY approx_key HAVING count\(\*\) > 1/, "key collisions");
    assert.match(detect, /LEFT JOIN gear_items g ON g\.brand_id = c\.id/, "gear references to duplicate brands");
    assert.match(detect, /HAVING count\(DISTINCT c\.id\) > 1/, "gear-name conflicts that would block repointing");
    assert.match(detect, /unnest\(coalesce\(up\.preferred_brands, '\{\}'\) \|\| coalesce\(up\.avoided_brands, '\{\}'\)\)/, "preference arrays");
    assert.doesNotMatch(detect, /user_profiles up WHERE EXISTS[\s\S]*SELECT up\.(id|user_id)/, "no user is identified");
    assert.match(detect, /select count\(\*\) FROM user_profiles up/i);
    assert.match(preview, /gear_items DESC, created_at, id/, "canonical-brand rule");
    assert.match(preview, /'KEEP \(canonical\)'/);
    assert.match(preview, /'MERGE INTO '/);
});

test("maintenance: no brand merge, dedupe or restore script exists - remediation is only a documented plan", () => {
    const files = readdirSync(`${root}prisma/maintenance`);
    const brandFiles = files.filter((file) => file.startsWith("brands_"));

    assert.deepEqual(brandFiles.sort(), ["brands_detect_duplicates.sql", "brands_merge_preview.sql"]);
    assert.equal(existsSync(`${root}scripts/backfillBrandKeys.ts`), false, "the JavaScript backfill is documented, not implemented");
});

test("maintenance: the audit script is read-only, reads only its own variable, and prints no credentials", () => {
    const source = read("scripts/brandKeyReport.ts");
    // Whole-line comments only: a trailing "//" can be inside a regular expression such as /^\//.
    const code = source.replace(/^\s*\/\/.*$/gm, "");

    assert.match(code, /BRAND_AUDIT_DATABASE_URL/);
    assert.doesNotMatch(code, /process\.env\.DATABASE_URL|process\.env\["DATABASE_URL"\]/, "it never falls back to the application's DATABASE_URL");
    assert.match(code, /SET TRANSACTION READ ONLY/);
    assert.match(code, /\$transaction\(/);
    assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/, "SELECT statements only");
    assert.doesNotMatch(code, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/, "no Prisma write calls");
    // The raw URL is parsed and handed to Prisma, but no console call may mention it or any credential part of it.
    const output = [...code.matchAll(/console\.(?:log|error|warn)\([^;]*\);/g)].map((match) => match[0]);
    assert.ok(output.length >= 4, "the script reports through console calls");
    for (const call of output) {
        assert.doesNotMatch(call, /\braw\b|password|username|\.href|\.toString\(\)|\$\{target\}|\$\{url\}/i, `credentials or the URL must not be printed: ${call.slice(0, 80)}`);
    }
    assert.match(code, /target\.hostname[\s\S]*target\.port[\s\S]*target\.pathname/, "only host, port and database name are shown");
});

test("maintenance: the audit distinguishes pre- and post-migration states and derives its exit code from blocking findings only", () => {
    const script = read("scripts/brandKeyReport.ts");
    const audit = read("lib/ingestion/brandKeyAudit.ts");

    assert.match(script, /auditBrands\(data\.brands, data\.gear, \{ keysStored: data\.hasKey \}\)/, "the script tells the auditor whether normalized_name exists");
    assert.match(script, /return auditExitCode\(report\)/, "the exit code comes from the shared rule");
    assert.doesNotMatch(script, /findings === 0 \? 0 : 2/, "no second copy of the rule");
    assert.match(audit, /export function auditExitCode\(report: BrandAuditReport\): 0 \| 2/);
    assert.match(audit, /const blockingUnsupported = mode === "pre-migration" \? unsupportedForSqlBackfill\.length : 0;/, "unsupported names block only before the migration");
    assert.match(audit, /findings: blockingUnsupported \+ invalidBrandNames\.length \+ collisionGroups\.length \+ storedKeyMismatches\.length/, "invalid names, collisions and key mismatches always block");
    assert.match(audit, /normalizeBrandKey\(brand\.name\)/, "stored keys are checked against the authoritative JavaScript function");
});

test("maintenance: the runbook documents the guarantee, the limits, the preflight order and the deferred paths", () => {
    const readme = read("prisma/maintenance/README.md");
    const brand = readme.slice(readme.indexOf("## Brand identity"));

    assert.ok(brand.length > 0);
    assert.match(brand, /cannot verify|Not guaranteed/i, "states that the database cannot prove writers computed keys correctly");
    assert.match(brand, /Database-side safeguards considered/);
    assert.match(brand, /JavaScript backfill[\s\S]*NOT implemented/i);
    assert.match(brand, /remediation plan[\s\S]*NOT implemented/i);
    assert.match(brand, /Migrate, then deploy/);
    assert.match(brand, /Expand \/ backfill \/ enforce/);
    assert.match(brand, /separate approval/);
    assert.match(brand, /P3018/);
    assert.match(brand, /P3009/);

    const order = ["brands_detect_duplicates.sql", "brandKeyReport.ts", "Apply the migration", "Verify"].map((needle) => brand.indexOf(needle, brand.indexOf("### Order of operations")));
    assert.ok(order.every((position) => position > 0));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), "census, exact audit, migrate, verify");
});

test("maintenance: no brand file contains a connection string or credential", () => {
    for (const path of ["prisma/maintenance/brands_detect_duplicates.sql", "prisma/maintenance/brands_merge_preview.sql", "scripts/brandKeyReport.ts", MIGRATION_PATH]) {
        assert.doesNotMatch(read(path), /postgres(ql)?:\/\/|password\s*=|passwd|secret|token/i, path);
    }
});

// --- Every brand-writing path -------------------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
    return readdirSync(`${root}${dir}`).flatMap((entry) => {
        const relative = `${dir}/${entry}`;
        if (["node_modules", ".next", "generated"].includes(entry)) return [];
        if (statSync(`${root}${relative}`).isDirectory()) return sourceFiles(relative);
        return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [relative] : [];
    });
}

// The call's text, from its opening parenthesis to the matching one.
function callText(source: string, openIndex: number): string {
    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
        if (source[index] === "(") depth += 1;
        else if (source[index] === ")" && --depth === 0) return source.slice(openIndex, index + 1);
    }
    return source.slice(openIndex);
}

test("every brand write in production source goes through the shared identity function", () => {
    const writes: Array<{ file: string; method: string; text: string }> = [];

    for (const file of ["app", "lib", "services", "prisma/seeds", "prisma/seed.ts", "scripts"].flatMap((entry) => (entry.endsWith(".ts") ? [entry] : sourceFiles(entry)))) {
        const source = read(file);
        for (const match of source.matchAll(/\bbrand\.(createMany|create|upsert|updateMany|update|deleteMany|delete)\s*\(/g)) {
            writes.push({ file, method: match[1], text: callText(source, (match.index as number) + match[0].length - 1) });
        }
    }

    assert.deepEqual(
        writes.map((write) => `${write.file}:${write.method}`).sort(),
        ["lib/db/brandRepository.ts:upsert", "lib/ingestion/brandStore.ts:upsert", "prisma/seeds/gear.seed.ts:upsert"],
        "the only brand writers are the admin repository, the CLI importer and the seed; no rename or delete path exists",
    );

    for (const write of writes) {
        assert.match(write.text, /where:\s*\{\s*normalizedName:/, `${write.file}: the lookup is by the unique normalized key`);
        assert.match(write.text, /create:\s*(\{\s*\.\.\.identity|identity)/, `${write.file}: the row is created from toBrandIdentity()`);
        assert.doesNotMatch(write.text, /update:\s*\{[^}]*\bname\b/, `${write.file}: an existing brand's display name is never rewritten`);
        assert.match(read(write.file), /toBrandIdentity/, `${write.file}: uses the shared function`);
    }
});

test("a future rename or key edit is guarded: no production code updates brands, and the rule is stated where writers look", () => {
    const repository = read("lib/db/brandRepository.ts");

    assert.match(repository, /A future rename must write `name` AND `normalizedName`/);
    assert.match(read("lib/ingestion/brandResolution.ts"), /future rename - which must write BOTH fields in one statement/);
});

test("the admin brand API keeps its response contract", () => {
    const route = read("app/api/admin/brands/route.ts");
    const repository = read("lib/db/brandRepository.ts");

    assert.match(route, /createBrand\(body\)/);
    assert.match(route, /NextResponse\.json\(created, \{ status: 201 \}\)/, "the success status is unchanged, also when an equivalent brand exists");
    assert.match(route, /NextResponse\.json\(await listBrands\(\)\)/);

    const select = repository.match(/const BRAND_SELECT = \{[^}]*\}/)?.[0] ?? "";
    assert.ok(select.length > 0);
    assert.doesNotMatch(select, /normalizedName/, "the internal key is not exposed");
    assert.match(repository, /select: BRAND_SELECT,\s*orderBy/, "listBrands uses the public select");
    assert.equal((repository.match(/select: BRAND_SELECT/g) ?? []).length, 2, "both list and create use it");
});

test("the importer's transaction and advisory-lock behavior is preserved", () => {
    const store = read("lib/ingestion/brandStore.ts");

    assert.match(store, /pg_advisory_xact_lock\(hashtext\(\$\{BRAND_RESOLUTION_LOCK_NAME\}\)\)/);
    assert.match(store, /BRAND_RESOLUTION_LOCK_NAME = "runlayer:catalog-import:brand-resolution"/, "the lock name is unchanged");
    assert.match(store, /\{ maxWait: 5_000, timeout: 15_000 \}/);
    assert.match(store, /planBrandResolution\(existing, references, "create-missing"\)/);
    assert.match(store, /planBrandResolution\(current, references, "require-existing"\)/);
});

test("the opt-in brand integration test is gated by the shared local-database guard", () => {
    const source = read("prisma/brandConstraints.integration.test.ts");

    assert.match(source, /checkTestDatabase\(process\.env\)/);
    assert.match(source, /const skipReason = !check\.ok \?/);
    assert.match(source, /\{ skip: skipReason \}/);
    assert.match(source, /DROP DATABASE IF EXISTS/);
    const assignments = [...source.matchAll(/process\.env\.DATABASE_URL\s*=\s*([^;]+);/g)].map((match) => match[1].trim());
    assert.ok(assignments.every((value) => value.startsWith("check.url")), "DATABASE_URL is only ever set to the guarded test URL");
});
