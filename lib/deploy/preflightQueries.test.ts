import assert from "node:assert/strict";
import test from "node:test";
import {
    ALL_PREFLIGHT_SQL,
    BRANDS_BEFORE_KEY_SQL,
    BRANDS_WITH_KEY_SQL,
    COLUMNS_SQL,
    COUNT_SQL,
    GEAR_BRANDS_SQL,
    HISTORY_SQL,
    IDENTITY_SQL,
    INDEXES_SQL,
    OUTFIT_DUPLICATES_SQL,
    PROFILE_BRANDS_SQL,
    PreflightError,
    SESSION_SETUP_SQL,
    TABLES_SQL,
    WRITE_PRIVILEGE_SQL,
    analyzePreflight,
    assertReadOnlySql,
    collectFacts,
    collectPreflight,
    type PreflightFacts,
    type ReadOnlyQueryable,
} from "./preflightQueries";
import { reportSchema } from "./preflightReport";
import { CONTEXT, MIGRATION_NAMES, MIGRATIONS, SENTINEL_PASSWORD, TARGET, behindFacts, currentFacts, emptyFacts, historyFor, reportFor } from "./testFixtures";

// ---- The SQL ---------------------------------------------------------------------------------------------------------

test("every preflight statement is a single read-only SELECT", () => {
    assert.ok(ALL_PREFLIGHT_SQL.length >= 15);
    for (const sql of ALL_PREFLIGHT_SQL) assertReadOnlySql(sql);
    for (const sql of ALL_PREFLIGHT_SQL) assert.match(sql.trimStart(), /^SELECT\b/i);
});

test("the only other statements are the fixed read-only session setup", () => {
    assert.deepEqual([...SESSION_SETUP_SQL], ["SET TRANSACTION READ ONLY", "SET LOCAL statement_timeout = '15s'", "SET LOCAL lock_timeout = '3s'", "SET LOCAL idle_in_transaction_session_timeout = '60s'"]);
    assert.equal(SESSION_SETUP_SQL[0], "SET TRANSACTION READ ONLY", "read-only must be the first statement");
    for (const sql of SESSION_SETUP_SQL) assert.doesNotMatch(sql, /READ WRITE|DEFAULT_TRANSACTION|ROLE|SESSION AUTHORIZATION|search_path/i);
});

test("statements that could write or act on the server are refused", () => {
    const unsafe = [
        "INSERT INTO brands (id) VALUES ('x')",
        "UPDATE brands SET name = 'x'",
        "DELETE FROM brands",
        "TRUNCATE brands",
        "DROP TABLE brands",
        "CREATE TABLE t (id int)",
        "CREATE TEMP TABLE t AS SELECT 1",
        "ALTER TABLE brands ADD COLUMN x int",
        "GRANT ALL ON brands TO public",
        "COPY brands TO '/tmp/x'",
        "SELECT * INTO copy_of_brands FROM brands",
        "SELECT 1; DROP TABLE brands",
        "SELECT 1; SELECT 2",
        "WITH gone AS (DELETE FROM brands RETURNING *) SELECT * FROM gone",
        "SELECT * FROM brands FOR UPDATE",
        "SELECT pg_advisory_lock(1)",
        "SELECT set_config('default_transaction_read_only', 'off', false)",
        "SELECT nextval('s')",
        "SELECT pg_terminate_backend(1)",
        "SELECT pg_sleep(100)",
        "SELECT lo_import('/etc/passwd')",
        "SELECT 1 /* hidden */",
        "SET TRANSACTION READ WRITE",
        "BEGIN",
        "COMMIT",
        "EXECUTE foo",
        "  ",
        "",
    ];
    for (const sql of unsafe) assert.throws(() => assertReadOnlySql(sql), PreflightError, sql);
});

test("keywords inside string literals do not trigger the scan, but outside them do", () => {
    assertReadOnlySql("SELECT 'DELETE FROM x; DROP TABLE y' AS note");
    assertReadOnlySql("SELECT has_database_privilege(current_user, current_database(), 'CREATE')");
    assert.throws(() => assertReadOnlySql("SELECT 'a' ; DELETE FROM x"));
});

// ---- Collection through a fake queryable ------------------------------------------------------------------------------

type Answers = Partial<Record<string, Array<Record<string, unknown>>>>;

function fake(answers: Answers) {
    const sent: string[] = [];
    const queryable: ReadOnlyQueryable = {
        async query<T>(sql: string) {
            sent.push(sql);
            const rows = answers[sql];
            if (!rows) throw new Error(`unexpected statement in test: ${sql.slice(0, 40)}`);
            return rows as T[];
        },
    };
    return { sent, queryable };
}

const identityRow = (overrides: Record<string, unknown> = {}) => ({ database: "appdb", server_version: "17.10", transaction_read_only: "on", in_recovery: false, is_superuser: false, can_create: false, ...overrides });
const WRITE_ROW = [{ can_write: false }];

test("identity is verified first; a wrong database stops collection immediately", async () => {
    const { sent, queryable } = fake({ [IDENTITY_SQL]: [identityRow({ database: "someone_elses_db" })] });
    await assert.rejects(collectFacts(queryable, TARGET), (error: unknown) => error instanceof PreflightError && error.code === "identity_mismatch");
    assert.deepEqual(sent, [IDENTITY_SQL]);
});

test("a session that is not read-only stops collection immediately", async () => {
    const { sent, queryable } = fake({ [IDENTITY_SQL]: [identityRow({ transaction_read_only: "off" })] });
    await assert.rejects(collectFacts(queryable, TARGET), (error: unknown) => error instanceof PreflightError && error.code === "not_read_only");
    assert.deepEqual(sent, [IDENTITY_SQL]);
});

test("an empty database is handled: no history, no audits, no queries on missing tables", async () => {
    const { sent, queryable } = fake({ [IDENTITY_SQL]: [identityRow()], [TABLES_SQL]: [], [COLUMNS_SQL]: [], [INDEXES_SQL]: [], [WRITE_PRIVILEGE_SQL]: WRITE_ROW });
    const report = await collectPreflight(queryable, CONTEXT);

    assert.equal(report.schema.state, "empty");
    assert.equal(report.schema.pending.length, MIGRATION_NAMES.length);
    assert.equal(report.verification.status, "pass");
    for (const sql of [HISTORY_SQL, OUTFIT_DUPLICATES_SQL, BRANDS_BEFORE_KEY_SQL, BRANDS_WITH_KEY_SQL]) assert.ok(!sent.includes(sql));
    assert.ok(sent.every((sql) => ALL_PREFLIGHT_SQL.includes(sql)));
});

test("a database without _prisma_migrations or later columns is handled", async () => {
    const { sent, queryable } = fake({
        [IDENTITY_SQL]: [identityRow()],
        [TABLES_SQL]: [{ table_name: "brands" }, { table_name: "gear_items" }],
        [COLUMNS_SQL]: [],
        [INDEXES_SQL]: [],
        [BRANDS_BEFORE_KEY_SQL]: [{ id: "b1", name: "Nike" }],
        [GEAR_BRANDS_SQL]: [{ brand_id: "b1", name: "Pegasus" }],
        [COUNT_SQL.brands]: [{ n: 1 }],
        [COUNT_SQL.gear_items]: [{ n: 1 }],
        [WRITE_PRIVILEGE_SQL]: WRITE_ROW,
    });
    const report = await collectPreflight(queryable, CONTEXT);

    assert.equal(report.schema.state, "untracked");
    assert.equal(report.verification.status, "fail");
    assert.equal(report.audits.brands.mode, "pre-migration");
    assert.ok(!sent.includes(HISTORY_SQL), "must not query a table that does not exist");
    assert.ok(!sent.includes(BRANDS_WITH_KEY_SQL), "must not select a column that does not exist");
});

test("the key column is selected only when it exists", async () => {
    const withKey = fake({
        [IDENTITY_SQL]: [identityRow()],
        [TABLES_SQL]: [{ table_name: "brands" }],
        [COLUMNS_SQL]: [{ table_name: "brands", column_name: "normalized_name", is_nullable: "NO" }],
        [INDEXES_SQL]: [],
        [BRANDS_WITH_KEY_SQL]: [{ id: "b1", name: "Nike", normalized_name: "nike" }],
        [COUNT_SQL.brands]: [{ n: 1 }],
        [WRITE_PRIVILEGE_SQL]: WRITE_ROW,
    });
    const facts = await collectFacts(withKey.queryable, TARGET);
    assert.equal(facts.brands?.keysStored, true);
    assert.ok(withKey.sent.includes(BRANDS_WITH_KEY_SQL) && !withKey.sent.includes(BRANDS_BEFORE_KEY_SQL));
});

test("a full database collects every section, and only registered statements are sent", async () => {
    const { sent, queryable } = fake({
        [IDENTITY_SQL]: [identityRow()],
        [TABLES_SQL]: ["_prisma_migrations", "brands", "gear_items", "outfit_items", "saved_outfits", "user_profiles", "users"].map((table_name) => ({ table_name })),
        [COLUMNS_SQL]: [
            { table_name: "users", column_name: "session_version", is_nullable: "NO" },
            { table_name: "brands", column_name: "normalized_name", is_nullable: "NO" },
        ],
        [INDEXES_SQL]: currentFacts().indexes.map((indexname) => ({ indexname })),
        [HISTORY_SQL]: MIGRATIONS.migrations.map((m) => ({ migration_name: m.name, checksum: m.checksum, finished: true, rolled_back: false })),
        [OUTFIT_DUPLICATES_SQL]: [{ duplicate_groups: 0, removable_rows: 0 }],
        [BRANDS_WITH_KEY_SQL]: [{ id: "b1", name: "Nike", normalized_name: "nike" }],
        [GEAR_BRANDS_SQL]: [{ brand_id: "b1", name: "Pegasus" }],
        [PROFILE_BRANDS_SQL]: [{ preferred_brands: ["Nike"], avoided_brands: null }],
        ...Object.fromEntries(Object.values(COUNT_SQL).map((sql) => [sql, [{ n: 1 }]])),
        [WRITE_PRIVILEGE_SQL]: WRITE_ROW,
    });
    const report = await collectPreflight(queryable, CONTEXT);

    assert.equal(report.schema.state, "current");
    assert.equal(report.verification.status, "pass");
    assert.ok(sent.every((sql) => ALL_PREFLIGHT_SQL.includes(sql)));
    assert.equal(sent[0], IDENTITY_SQL);
    reportSchema.parse(report);
});

test("malformed database answers are rejected, not guessed at", async () => {
    const { queryable } = fake({ [IDENTITY_SQL]: [identityRow({ in_recovery: "no" })], [TABLES_SQL]: [], [COLUMNS_SQL]: [], [INDEXES_SQL]: [], [WRITE_PRIVILEGE_SQL]: WRITE_ROW });
    await assert.rejects(collectFacts(queryable, TARGET), (error: unknown) => error instanceof PreflightError && error.code === "unexpected_result");
});

// ---- Analysis ---------------------------------------------------------------------------------------------------------

const codes = (facts: PreflightFacts, severity?: "blocking" | "warning" | "info") =>
    reportFor(facts)
        .findings.filter((finding) => !severity || finding.severity === severity)
        .map((finding) => finding.code);

test("empty, behind and current schemas classify correctly and pass", () => {
    assert.equal(reportFor(emptyFacts()).schema.state, "empty");
    const behind = reportFor(behindFacts());
    assert.equal(behind.schema.state, "behind");
    assert.deepEqual(behind.schema.pending, MIGRATION_NAMES.slice(7));
    assert.equal(reportFor(currentFacts()).schema.state, "current");
    for (const facts of [emptyFacts(), behindFacts(), currentFacts()]) assert.equal(reportFor(facts).verification.status, "pass");
    assert.deepEqual(codes(currentFacts(), "blocking"), []);
});

test("a schema with tables but no migration history is blocking", () => {
    assert.ok(codes(currentFacts({ history: null }), "blocking").includes("schema_untracked_nonempty"));
});

test("an unresolved failed migration is blocking, a rolled-back one is not", () => {
    const failedRow = { name: MIGRATION_NAMES[9], checksum: MIGRATIONS.migrations[9].checksum, finished: false, rolledBack: false };
    assert.ok(codes(behindFacts({ history: [...historyFor(MIGRATION_NAMES.slice(0, 9)), failedRow] }), "blocking").includes("migration_failed_unresolved"));

    const resolved = { ...failedRow, rolledBack: true };
    assert.ok(!codes(behindFacts({ history: [...historyFor(MIGRATION_NAMES.slice(0, 7)), resolved] }), "blocking").includes("migration_failed_unresolved"));
});

test("history that disagrees with the repository is blocking", () => {
    const unknown = codes(currentFacts({ history: [...historyFor(MIGRATION_NAMES), { name: "20300101000000_from_elsewhere", checksum: "0".repeat(64), finished: true, rolledBack: false }] }), "blocking");
    assert.ok(unknown.includes("migration_history_diverged"));

    const edited = historyFor(MIGRATION_NAMES).map((row, index) => (index === 2 ? { ...row, checksum: "f".repeat(64) } : row));
    assert.ok(codes(currentFacts({ history: edited }), "blocking").includes("migration_checksum_mismatch"));
    assert.equal(reportFor(currentFacts({ history: edited })).schema.state, "diverged");

    const gap = historyFor(MIGRATION_NAMES.filter((name) => name !== MIGRATION_NAMES[3]));
    assert.ok(codes(currentFacts({ history: gap }), "blocking").includes("migration_out_of_order"));
});

test("a schema that disagrees with its history is blocking drift", () => {
    const missing = reportFor(currentFacts({ columns: [{ table: "users", column: "session_version", nullable: false }] }));
    assert.equal(missing.schema.state, "drift");
    assert.ok(missing.findings.some((finding) => finding.code === "schema_missing_objects" && finding.ids?.includes(MIGRATION_NAMES[9])));

    const nullable = reportFor(currentFacts({ columns: [{ table: "users", column: "session_version", nullable: false }, { table: "brands", column: "normalized_name", nullable: true }] }));
    assert.equal(nullable.schema.state, "drift");

    const unexpected = reportFor(behindFacts({ indexes: ["outfit_items_outfit_id_gear_item_id_key"] }));
    assert.equal(unexpected.schema.state, "drift");
    assert.ok(unexpected.findings.some((finding) => finding.code === "schema_unexpected_objects"));

    const earlyColumn = reportFor(behindFacts({ columns: [{ table: "users", column: "session_version", nullable: false }] }));
    assert.ok(earlyColumn.findings.some((finding) => finding.code === "schema_unexpected_objects" && finding.ids?.includes(MIGRATION_NAMES[7])));
});

test("duplicate outfit items are detected and block", () => {
    const report = reportFor(currentFacts({ outfitDuplicates: { groups: 3, removableRows: 5 } }));
    assert.equal(report.audits.outfitItems.duplicateGroups, 3);
    assert.equal(report.audits.outfitItems.removableRows, 5);
    assert.equal(report.audits.outfitItems.uniqueIndexPresent, true);
    assert.ok(report.findings.some((finding) => finding.code === "outfit_duplicates_present" && finding.severity === "blocking" && finding.count === 3));
    assert.equal(reportFor(currentFacts()).audits.outfitItems.duplicateGroups, 0);
});

test("brand key collisions are detected and block", () => {
    const rows = [
        { id: "b1", name: "Nike" },
        { id: "b2", name: "NIKE" },
        { id: "b3", name: " nike " },
        { id: "b4", name: "Adidas" },
    ];
    const facts = behindFacts({
        brands: { keysStored: false, rows },
        gear: [
            { brandId: "b1", name: "Pegasus" },
            { brandId: "b2", name: "Pegasus" },
        ],
        preferenceLists: [["Nike"], ["nike"], ["Adidas"]],
    });
    const report = reportFor(facts);

    assert.equal(report.audits.brands.collisionGroups, 1);
    assert.equal(report.audits.brands.gearNameConflicts, 1);
    assert.equal(report.audits.brands.profilesListingAffected, 2);
    assert.equal(report.verification.status, "fail");
    const finding = report.findings.find((f) => f.code === "brand_key_collisions");
    assert.deepEqual(finding?.ids?.sort(), ["b1", "b2", "b3"]);
    assert.ok(report.findings.some((f) => f.code === "brand_gear_name_conflicts" && f.severity === "info"));
});

test("non-ASCII brand names block before the key column exists and are informational after", () => {
    const pre = reportFor(behindFacts({ brands: { keysStored: false, rows: [{ id: "b1", name: "Nïke" }, { id: "b2", name: "Adidas" }] } }));
    assert.equal(pre.audits.brands.mode, "pre-migration");
    assert.equal(pre.audits.brands.unsupportedForSqlBackfill, 1);
    assert.ok(pre.findings.some((f) => f.code === "brand_names_unsupported_for_sql_backfill" && f.severity === "blocking"));

    const post = reportFor(currentFacts({ brands: { keysStored: true, rows: [{ id: "b1", name: "Nïke", storedKey: "nïke" }, { id: "b2", name: "Adidas", storedKey: "adidas" }] } }));
    assert.equal(post.audits.brands.mode, "post-migration");
    assert.equal(post.verification.status, "pass");
    assert.ok(post.findings.some((f) => f.code === "brand_non_ascii_names_present" && f.severity === "info"));
});

test("invalid brand names block", () => {
    const report = reportFor(behindFacts({ brands: { keysStored: false, rows: [{ id: "b1", name: "   " }, { id: "b2", name: "Adidas" }] } }));
    assert.ok(report.findings.some((f) => f.code === "brand_invalid_names" && f.severity === "blocking"));
});

test("stored brand keys are verified after the migration", () => {
    const wrong = reportFor(currentFacts({ brands: { keysStored: true, rows: [{ id: "b1", name: "Nike", storedKey: "NIKE" }, { id: "b2", name: "Adidas", storedKey: "adidas" }] } }));
    assert.equal(wrong.audits.brands.storedKeyMismatches, 1);
    assert.ok(wrong.findings.some((f) => f.code === "brand_stored_key_mismatch" && f.severity === "blocking"));

    const missing = reportFor(currentFacts({ brands: { keysStored: true, rows: [{ id: "b1", name: "Nike", storedKey: null }] } }));
    assert.equal(missing.audits.brands.storedKeyMismatches, 1);
});

test("session-version readiness is recorded", () => {
    assert.equal(reportFor(currentFacts()).audits.sessions.columnPresent, true);
    assert.equal(reportFor(currentFacts()).audits.sessions.users, 3);
    assert.equal(reportFor(behindFacts()).audits.sessions.columnPresent, false);
    assert.equal(reportFor(emptyFacts()).audits.sessions.status, "not_applicable");
});

test("server and role observations", () => {
    assert.ok(codes(currentFacts({ identity: { ...currentFacts().identity, inRecovery: true } }), "blocking").includes("server_in_recovery"));

    const warnings = codes(currentFacts({ identity: { ...currentFacts().identity, serverVersion: "15.8", isSuperuser: true, canCreate: true, canWrite: true } }), "warning");
    assert.deepEqual(warnings.sort(), ["role_can_create", "role_can_write", "role_is_superuser", "server_major_not_verified"]);
    for (const version of ["14.19", "17.10"]) assert.ok(!codes(currentFacts({ identity: { ...currentFacts().identity, serverVersion: version } })).includes("server_major_not_verified"));
});

test("incomplete facts are an error, never a silent pass", () => {
    assert.throws(() => analyzePreflight({ ...currentFacts(), outfitDuplicates: null }, CONTEXT), PreflightError);
    assert.throws(() => analyzePreflight({ ...currentFacts(), brands: null }, CONTEXT), PreflightError);
});

test("the report holds no credentials, brand names, preferences or other personal data", () => {
    const text = JSON.stringify(reportFor(behindFacts({ brands: { keysStored: false, rows: [{ id: "brand-1", name: "VERY-SECRET-BRAND-NAME" }] }, preferenceLists: [["SECRET-USER-PREFERENCE", "VERY-SECRET-BRAND-NAME"]] })));
    for (const forbidden of [SENTINEL_PASSWORD, "VERY-SECRET-BRAND-NAME", "SECRET-USER-PREFERENCE", "postgresql://", "svc"]) assert.ok(!text.includes(forbidden), forbidden);
    assert.ok(text.includes(TARGET.key));
});

test("long id lists are capped", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: `b${i}`, name: i % 2 ? "Dup" : "dup" }));
    const finding = reportFor(behindFacts({ brands: { keysStored: false, rows } })).findings.find((f) => f.code === "brand_key_collisions");
    assert.ok(finding && finding.ids && finding.ids.length === 50);
});

test("schema discovery does not depend on the preflight role's privileges", () => {
    // information_schema lists only objects the current role may access; a restricted role would see an empty schema.
    for (const sql of [TABLES_SQL, COLUMNS_SQL, INDEXES_SQL]) assert.doesNotMatch(sql, /information_schema/i);
    assert.match(TABLES_SQL, /pg_catalog\.pg_tables/);
    assert.match(COLUMNS_SQL, /pg_catalog\.pg_attribute/);
});
