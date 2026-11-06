// Read-only evidence collection for the preflight, split into three layers so each can be tested without a database:
//
//   1. The SQL itself (constants below). Every statement is a SELECT. A runtime check (assertReadOnlySql) refuses to send
//      anything else, and a test enumerates ALL_PREFLIGHT_SQL, so a statement that could write cannot be added unnoticed.
//   2. collectFacts: runs the statements through an injected ReadOnlyQueryable, verifying the target's identity BEFORE it
//      collects anything else, and asking only about tables that exist (a query on a missing table would abort the
//      transaction). This module never opens a connection; scripts/preflight.ts supplies the queryable.
//   3. analyzePreflight: a pure function from facts to the report body. No I/O.
//
// Nothing here creates a user, role, schema, table, index or temporary object.

import { auditBrands, countPreferenceMentions } from "../ingestion/brandKeyAudit";
import type { DatabaseTarget } from "./databaseTarget";
import type { MigrationSet } from "./migrationFingerprint";
import { REPORT_VERSION, TOOL_NAME, TOOL_VERSION, sealReport, type Finding, type PreflightReport, type PreflightReportBody, type SchemaState } from "./preflightReport";

// ---------------------------------------------------------------------------------------------------------------------
// 1. SQL
// ---------------------------------------------------------------------------------------------------------------------

/** Run first, in this order, inside the transaction. These are the ONLY non-SELECT statements the preflight sends. */
export const SESSION_SETUP_SQL = [
    "SET TRANSACTION READ ONLY",
    "SET LOCAL statement_timeout = '15s'",
    "SET LOCAL lock_timeout = '3s'",
    "SET LOCAL idle_in_transaction_session_timeout = '60s'",
] as const;

export const IDENTITY_SQL = `SELECT current_database() AS database,
       current_setting('server_version') AS server_version,
       current_setting('transaction_read_only') AS transaction_read_only,
       pg_is_in_recovery() AS in_recovery,
       COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser,
       has_database_privilege(current_user, current_database(), 'CREATE') AS can_create`;

// pg_catalog views, not information_schema: information_schema only lists objects the current role may access, so a
// tightly restricted role would see an empty schema and a populated database would be mistaken for an empty one.
export const TABLES_SQL = `SELECT tablename AS table_name
FROM pg_catalog.pg_tables
WHERE schemaname = current_schema()
ORDER BY tablename`;

export const COLUMNS_SQL = `SELECT c.relname AS table_name, a.attname AS column_name, CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = current_schema()
  AND c.relkind = 'r'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND ((c.relname = 'users' AND a.attname = 'session_version')
    OR (c.relname = 'brands' AND a.attname = 'normalized_name'))`;

export const INDEXES_SQL = `SELECT indexname
FROM pg_indexes
WHERE schemaname = current_schema()
  AND indexname IN ('outfit_items_outfit_id_gear_item_id_key', 'outfit_items_gear_item_id_idx', 'saved_outfits_user_id_created_at_idx', 'brands_normalized_name_key')`;

export const HISTORY_SQL = `SELECT migration_name, checksum, (finished_at IS NOT NULL) AS finished, (rolled_back_at IS NOT NULL) AS rolled_back
FROM _prisma_migrations
ORDER BY migration_name`;

export const OUTFIT_DUPLICATES_SQL = `SELECT count(*)::int AS duplicate_groups, COALESCE(sum(copies - 1), 0)::int AS removable_rows
FROM (
    SELECT count(*) AS copies
    FROM outfit_items
    GROUP BY outfit_id, gear_item_id
    HAVING count(*) > 1
) AS duplicate_groups`;

export const BRANDS_BEFORE_KEY_SQL = "SELECT id, name FROM brands";
export const BRANDS_WITH_KEY_SQL = "SELECT id, name, normalized_name FROM brands";
export const GEAR_BRANDS_SQL = "SELECT brand_id, name FROM gear_items";
export const PROFILE_BRANDS_SQL = "SELECT preferred_brands, avoided_brands FROM user_profiles";

export const COUNT_SQL = {
    users: "SELECT count(*)::int AS n FROM users",
    brands: "SELECT count(*)::int AS n FROM brands",
    gear_items: "SELECT count(*)::int AS n FROM gear_items",
    saved_outfits: "SELECT count(*)::int AS n FROM saved_outfits",
    outfit_items: "SELECT count(*)::int AS n FROM outfit_items",
} as const;

export const WRITE_PRIVILEGE_SQL = `SELECT COALESCE(bool_or(has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'INSERT,UPDATE,DELETE,TRUNCATE')), false) AS can_write
FROM pg_tables
WHERE schemaname = current_schema()`;

export const ALL_PREFLIGHT_SQL: readonly string[] = [
    IDENTITY_SQL,
    TABLES_SQL,
    COLUMNS_SQL,
    INDEXES_SQL,
    HISTORY_SQL,
    OUTFIT_DUPLICATES_SQL,
    BRANDS_BEFORE_KEY_SQL,
    BRANDS_WITH_KEY_SQL,
    GEAR_BRANDS_SQL,
    PROFILE_BRANDS_SQL,
    ...Object.values(COUNT_SQL),
    WRITE_PRIVILEGE_SQL,
];

const FORBIDDEN_KEYWORDS =
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|CALL|DO|LOCK|VACUUM|REINDEX|CLUSTER|REFRESH|COMMENT|SET|RESET|NOTIFY|LISTEN|PREPARE|EXECUTE|DISCARD|INTO|BEGIN|COMMIT|ROLLBACK)\b/i;

/** Functions that act on the server (locks, settings, sessions, files, other databases) even inside a SELECT. */
const FORBIDDEN_FUNCTIONS = /\b(pg_advisory\w*|nextval|setval|set_config|pg_terminate_backend|pg_cancel_backend|pg_sleep\w*|lo_\w+|dblink\w*|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_read_\w+|pg_ls_\w+)\b/i;

/** Throws unless `sql` is a single read-only SELECT/WITH statement. String literals are ignored by the keyword scan. */
export function assertReadOnlySql(sql: string): void {
    const stripped = sql
        .replace(/'(?:[^']|'')*'/g, "''")
        .replace(/--[^\n]*/g, "")
        .trim();

    if (!/^(SELECT|WITH)\b/i.test(stripped) || stripped.includes("/*")) throw new PreflightError("unsafe_sql");
    if (stripped.replace(/;\s*$/, "").includes(";")) throw new PreflightError("unsafe_sql");
    if (FORBIDDEN_KEYWORDS.test(stripped) || FORBIDDEN_FUNCTIONS.test(stripped)) throw new PreflightError("unsafe_sql");
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Collection
// ---------------------------------------------------------------------------------------------------------------------

export type PreflightErrorCode = "unsafe_sql" | "not_read_only" | "identity_mismatch" | "unexpected_result" | "incomplete_facts";

const ERROR_MESSAGES: Record<PreflightErrorCode, string> = {
    unsafe_sql: "Refusing to send a statement that is not a single read-only SELECT.",
    not_read_only: "The database session is not read-only; nothing was collected.",
    identity_mismatch: "The connected database is not the one named by the target; nothing was collected.",
    unexpected_result: "The database returned a result in an unexpected shape.",
    incomplete_facts: "The collected facts are incomplete.",
};

export class PreflightError extends Error {
    readonly code: PreflightErrorCode;

    constructor(code: PreflightErrorCode) {
        super(ERROR_MESSAGES[code]);
        this.name = "PreflightError";
        this.code = code;
    }
}

export interface ReadOnlyQueryable {
    query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

type HistoryRow = { name: string; checksum: string; finished: boolean; rolledBack: boolean };

export type PreflightFacts = {
    identity: { database: string; serverVersion: string; inRecovery: boolean; isSuperuser: boolean; canCreate: boolean; canWrite: boolean };
    tables: string[];
    columns: Array<{ table: string; column: string; nullable: boolean }>;
    indexes: string[];
    history: HistoryRow[] | null;
    outfitDuplicates: { groups: number; removableRows: number } | null;
    brands: { rows: Array<{ id: string; name: string; storedKey?: string | null }>; keysStored: boolean } | null;
    gear: Array<{ brandId: string; name: string }>;
    preferenceLists: string[][];
    rowCounts: Record<string, number>;
};

const TABLES_OF_INTEREST = ["users", "brands", "gear_items", "saved_outfits", "outfit_items", "user_profiles"] as const;

function asBoolean(value: unknown): boolean {
    if (typeof value !== "boolean") throw new PreflightError("unexpected_result");
    return value;
}

function asString(value: unknown): string {
    if (typeof value !== "string") throw new PreflightError("unexpected_result");
    return value;
}

function asCount(value: unknown): number {
    const number = typeof value === "bigint" ? Number(value) : value;
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0) throw new PreflightError("unexpected_result");
    return number;
}

/**
 * Collects the facts. The FIRST statement asks who we are connected to and whether the session is read-only; if either
 * answer is wrong it throws before any evidence is gathered.
 */
export async function collectFacts(queryable: ReadOnlyQueryable, target: DatabaseTarget): Promise<PreflightFacts> {
    const run = async <T = Record<string, unknown>>(sql: string): Promise<T[]> => {
        assertReadOnlySql(sql);
        return queryable.query<T>(sql);
    };

    const [identityRow] = await run(IDENTITY_SQL);
    if (!identityRow) throw new PreflightError("unexpected_result");
    if (asString(identityRow.transaction_read_only) !== "on") throw new PreflightError("not_read_only");
    if (asString(identityRow.database) !== target.database) throw new PreflightError("identity_mismatch");

    const tables = (await run(TABLES_SQL)).map((row) => asString(row.table_name));
    const present = new Set(tables);

    const columns = (await run(COLUMNS_SQL)).map((row) => ({ table: asString(row.table_name), column: asString(row.column_name), nullable: asString(row.is_nullable) === "YES" }));
    const indexes = (await run(INDEXES_SQL)).map((row) => asString(row.indexname));

    const history = present.has("_prisma_migrations")
        ? (await run(HISTORY_SQL)).map((row) => ({ name: asString(row.migration_name), checksum: asString(row.checksum), finished: asBoolean(row.finished), rolledBack: asBoolean(row.rolled_back) }))
        : null;

    let outfitDuplicates: PreflightFacts["outfitDuplicates"] = null;
    if (present.has("outfit_items")) {
        const [row] = await run(OUTFIT_DUPLICATES_SQL);
        if (!row) throw new PreflightError("unexpected_result");
        outfitDuplicates = { groups: asCount(row.duplicate_groups), removableRows: asCount(row.removable_rows) };
    }

    let brands: PreflightFacts["brands"] = null;
    let gear: PreflightFacts["gear"] = [];
    let preferenceLists: string[][] = [];
    if (present.has("brands")) {
        const keysStored = columns.some((column) => column.table === "brands" && column.column === "normalized_name");
        const rows = await run(keysStored ? BRANDS_WITH_KEY_SQL : BRANDS_BEFORE_KEY_SQL);
        brands = {
            keysStored,
            rows: rows.map((row) => ({ id: asString(row.id), name: asString(row.name), ...(keysStored ? { storedKey: row.normalized_name === null ? null : asString(row.normalized_name) } : {}) })),
        };

        if (present.has("gear_items")) gear = (await run(GEAR_BRANDS_SQL)).map((row) => ({ brandId: asString(row.brand_id), name: asString(row.name) }));
        if (present.has("user_profiles")) {
            preferenceLists = (await run(PROFILE_BRANDS_SQL)).map((row) => [...((row.preferred_brands as string[] | null) ?? []), ...((row.avoided_brands as string[] | null) ?? [])].filter((entry) => typeof entry === "string"));
        }
    }

    const rowCounts: Record<string, number> = {};
    for (const [table, sql] of Object.entries(COUNT_SQL)) {
        if (!present.has(table)) continue;
        const [row] = await run(sql);
        if (!row) throw new PreflightError("unexpected_result");
        rowCounts[table] = asCount(row.n);
    }

    const [writeRow] = await run(WRITE_PRIVILEGE_SQL);

    return {
        identity: {
            database: asString(identityRow.database),
            serverVersion: asString(identityRow.server_version),
            inRecovery: asBoolean(identityRow.in_recovery),
            isSuperuser: asBoolean(identityRow.is_superuser),
            canCreate: asBoolean(identityRow.can_create),
            canWrite: writeRow ? asBoolean(writeRow.can_write) : false,
        },
        tables,
        columns,
        indexes,
        history,
        outfitDuplicates,
        brands,
        gear,
        preferenceLists,
        rowCounts,
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Analysis (pure)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Objects each pending-or-applied migration is known to create. Used to notice a schema that disagrees with its own
 * migration history (drift): an applied migration whose objects are missing, or an unapplied one whose objects already exist
 * (it would fail with "already exists").
 */
const KNOWN_OBJECTS: Record<string, string[]> = {
    "20261104160000_add_user_session_version": ["column:users.session_version"],
    "20261105180000_add_outfit_item_constraints_and_indexes": ["index:outfit_items_outfit_id_gear_item_id_key", "index:outfit_items_gear_item_id_idx", "index:saved_outfits_user_id_created_at_idx"],
    "20261105200000_add_brand_normalized_name": ["column:brands.normalized_name", "not_null:brands.normalized_name", "index:brands_normalized_name_key"],
};

/** PostgreSQL major versions the disposable-database verification covered. */
export const VERIFIED_POSTGRES_MAJORS = [14, 17] as const;

const MAX_IDS = 50;
const unique = <T>(values: T[]): T[] => [...new Set(values)];
const sorted = (values: string[]): string[] => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export type AnalysisContext = { target: DatabaseTarget; migrationSet: MigrationSet; now: Date };

export function analyzePreflight(facts: PreflightFacts, context: AnalysisContext): PreflightReportBody {
    const findings: Finding[] = [];
    const block = (code: string, message: string, extra: Partial<Finding> = {}) => findings.push({ code, severity: "blocking", message, ...extra });
    const warn = (code: string, message: string, extra: Partial<Finding> = {}) => findings.push({ code, severity: "warning", message, ...extra });
    const info = (code: string, message: string, extra: Partial<Finding> = {}) => findings.push({ code, severity: "info", message, ...extra });
    const idList = (ids: string[]) => ids.slice(0, MAX_IDS);

    const repoNames = context.migrationSet.migrations.map((migration) => migration.name);
    const localChecksums = new Map(context.migrationSet.migrations.map((migration) => [migration.name, migration.checksum]));
    const tables = new Set(facts.tables);

    // --- Migration history and schema state -------------------------------------------------------------------------
    let applied: string[] = [];
    let failed: string[] = [];
    let unknownApplied: string[] = [];
    let checksumMismatches: string[] = [];
    let pending = [...repoNames];
    let state: SchemaState;

    if (facts.history === null) {
        if (tables.size === 0) {
            state = "empty";
        } else {
            state = "untracked";
            block("schema_untracked_nonempty", "The schema has tables but no _prisma_migrations history; Prisma would refuse to migrate it (P3005). It needs a person to decide how to baseline it.", { count: tables.size });
        }
    } else {
        const appliedRows = facts.history.filter((row) => row.finished && !row.rolledBack);
        const appliedSet = new Set(appliedRows.map((row) => row.name));
        applied = sorted([...appliedSet]);
        failed = sorted(unique(facts.history.filter((row) => !row.finished && !row.rolledBack).map((row) => row.name)));
        unknownApplied = applied.filter((name) => !localChecksums.has(name));
        checksumMismatches = sorted(unique(appliedRows.filter((row) => localChecksums.has(row.name) && localChecksums.get(row.name) !== row.checksum).map((row) => row.name)));
        pending = repoNames.filter((name) => !appliedSet.has(name));

        const lastApplied = applied.filter((name) => localChecksums.has(name)).at(-1);
        const outOfOrder = lastApplied === undefined ? [] : pending.filter((name) => name < lastApplied && !failed.includes(name));

        if (failed.length) block("migration_failed_unresolved", "A migration is recorded as failed and unresolved; Prisma refuses further migrations (P3009).", { count: failed.length, ids: idList(failed) });
        if (unknownApplied.length) block("migration_history_diverged", "The database records applied migrations that do not exist in this repository.", { count: unknownApplied.length, ids: idList(unknownApplied) });
        if (checksumMismatches.length) block("migration_checksum_mismatch", "An applied migration's recorded checksum differs from the file in this repository.", { count: checksumMismatches.length, ids: idList(checksumMismatches) });
        if (outOfOrder.length) block("migration_out_of_order", "A repository migration sorts before one already applied but has not been applied itself.", { count: outOfOrder.length, ids: idList(outOfOrder) });

        const presentObjects = new Set<string>([
            ...facts.columns.map((column) => `column:${column.table}.${column.column}`),
            ...facts.columns.filter((column) => !column.nullable).map((column) => `not_null:${column.table}.${column.column}`),
            ...facts.indexes.map((index) => `index:${index}`),
        ]);
        const missing: string[] = [];
        const unexpected: string[] = [];
        for (const name of repoNames) {
            const objects = KNOWN_OBJECTS[name];
            if (!objects) continue;
            if (appliedSet.has(name)) {
                if (objects.some((object) => !presentObjects.has(object))) missing.push(name);
            } else if (objects.some((object) => presentObjects.has(object))) {
                unexpected.push(name);
            }
        }
        if (missing.length) block("schema_missing_objects", "A migration is recorded as applied but the objects it creates are not all present.", { count: missing.length, ids: idList(missing) });
        if (unexpected.length) block("schema_unexpected_objects", "Objects a pending migration would create already exist; the migration would fail.", { count: unexpected.length, ids: idList(unexpected) });

        if (failed.length) state = "failed_migration";
        else if (unknownApplied.length || checksumMismatches.length || outOfOrder.length) state = "diverged";
        else if (missing.length || unexpected.length) state = "drift";
        else state = pending.length > 0 ? "behind" : "current";
    }

    // --- Server ------------------------------------------------------------------------------------------------------
    if (facts.identity.inRecovery) block("server_in_recovery", "The server is in recovery (a replica); it cannot be migrated.");
    const major = Number.parseInt(facts.identity.serverVersion, 10);
    if (!(VERIFIED_POSTGRES_MAJORS as readonly number[]).includes(major)) {
        warn("server_major_not_verified", `PostgreSQL ${Number.isFinite(major) ? major : "?"} was not part of the disposable-database verification (${VERIFIED_POSTGRES_MAJORS.join(", ")}); rehearse on a restored copy.`);
    }
    if (facts.identity.isSuperuser) warn("role_is_superuser", "The preflight role is a superuser; use a dedicated read-only role.");
    if (facts.identity.canCreate) warn("role_can_create", "The preflight role can create objects in the database; use a dedicated read-only role.");
    if (facts.identity.canWrite) warn("role_can_write", "The preflight role holds write privileges on tables; use a dedicated read-only role.");

    // --- Audits ------------------------------------------------------------------------------------------------------
    let outfitItems: PreflightReportBody["audits"]["outfitItems"] = { status: "not_applicable", duplicateGroups: 0, removableRows: 0, uniqueIndexPresent: false };
    if (tables.has("outfit_items")) {
        if (!facts.outfitDuplicates) throw new PreflightError("incomplete_facts");
        outfitItems = {
            status: "complete",
            duplicateGroups: facts.outfitDuplicates.groups,
            removableRows: facts.outfitDuplicates.removableRows,
            uniqueIndexPresent: facts.indexes.includes("outfit_items_outfit_id_gear_item_id_key"),
        };
        if (outfitItems.duplicateGroups > 0) {
            block("outfit_duplicates_present", "outfit_items holds duplicate (outfit_id, gear_item_id) groups; the unique index cannot be created until they are remediated.", { count: outfitItems.duplicateGroups });
        }
    }

    let brandsAudit: PreflightReportBody["audits"]["brands"] = {
        status: "not_applicable",
        mode: null,
        total: 0,
        unsupportedForSqlBackfill: 0,
        invalidNames: 0,
        collisionGroups: 0,
        gearNameConflicts: 0,
        storedKeyMismatches: 0,
        profilesListingAffected: 0,
    };
    if (tables.has("brands")) {
        if (!facts.brands) throw new PreflightError("incomplete_facts");
        const report = auditBrands(facts.brands.rows, facts.gear, { keysStored: facts.brands.keysStored });
        const mentions = countPreferenceMentions(report, facts.preferenceLists).reduce((sum, entry) => sum + entry.profiles, 0);
        const conflicts = report.collisionGroups.reduce((sum, group) => sum + group.gearNameConflicts.length, 0);

        brandsAudit = {
            status: "complete",
            mode: report.mode,
            total: report.total,
            unsupportedForSqlBackfill: report.unsupportedForSqlBackfill.length,
            invalidNames: report.invalidBrandNames.length,
            collisionGroups: report.collisionGroups.length,
            gearNameConflicts: conflicts,
            storedKeyMismatches: report.storedKeyMismatches.length,
            profilesListingAffected: mentions,
        };

        if (report.invalidBrandNames.length) block("brand_invalid_names", "Some brand names are blank, contain control characters or are over-long; the application would never accept them.", { count: report.invalidBrandNames.length, ids: idList(report.invalidBrandNames.map((brand) => brand.id)) });
        if (report.collisionGroups.length) {
            block("brand_key_collisions", "Brands exist whose normalized keys are identical; the unique key cannot be created until they are merged by a person.", {
                count: report.collisionGroups.length,
                ids: idList(report.collisionGroups.flatMap((group) => group.brands.map((brand) => brand.id))),
            });
        }
        if (conflicts > 0) info("brand_gear_name_conflicts", "Gear names exist under more than one brand of a colliding group; an automatic merge would be blocked.", { count: conflicts });
        if (report.mode === "pre-migration" && report.unsupportedForSqlBackfill.length) {
            block("brand_names_unsupported_for_sql_backfill", "Some brand names are not printable ASCII; the migration's SQL backfill refuses them. They need the JavaScript backfill path.", { count: report.unsupportedForSqlBackfill.length, ids: idList(report.unsupportedForSqlBackfill.map((brand) => brand.id)) });
        }
        if (report.mode === "post-migration" && report.unsupportedForSqlBackfill.length) {
            info("brand_non_ascii_names_present", "Some brand names are not printable ASCII; informational once the key column exists.", { count: report.unsupportedForSqlBackfill.length });
        }
        if (report.storedKeyMismatches.length) block("brand_stored_key_mismatch", "A stored normalized_name differs from the key the application computes for that brand.", { count: report.storedKeyMismatches.length, ids: idList(report.storedKeyMismatches.map((brand) => brand.id)) });
        if (mentions > 0) info("profiles_listing_affected_brands", "User profiles list a colliding brand as preferred or avoided (a count only; no user is identified).", { count: mentions });
    }

    let sessions: PreflightReportBody["audits"]["sessions"] = { status: "not_applicable", columnPresent: false, users: 0 };
    if (tables.has("users")) {
        sessions = {
            status: "complete",
            columnPresent: facts.columns.some((column) => column.table === "users" && column.column === "session_version"),
            users: facts.rowCounts.users ?? 0,
        };
    }

    const blockingFindings = findings.filter((finding) => finding.severity === "blocking").length;

    return {
        reportVersion: REPORT_VERSION,
        tool: { name: TOOL_NAME, version: TOOL_VERSION },
        collectedAt: context.now.toISOString(),
        target: {
            key: context.target.key,
            database: facts.identity.database,
            serverVersion: facts.identity.serverVersion,
            inRecovery: facts.identity.inRecovery,
            identityVerified: facts.identity.database === context.target.database,
            readOnlyTransaction: true,
        },
        role: { superuser: facts.identity.isSuperuser, canCreate: facts.identity.canCreate, canWrite: facts.identity.canWrite },
        migrationSet: { fingerprint: context.migrationSet.fingerprint, count: repoNames.length, names: repoNames },
        schema: {
            state,
            hasMigrationHistory: facts.history !== null,
            tablesPresent: sorted(facts.tables.filter((table) => (TABLES_OF_INTEREST as readonly string[]).includes(table))),
            applied,
            pending,
            failed,
            unknownApplied,
            checksumMismatches,
        },
        audits: { outfitItems, brands: brandsAudit, sessions },
        rowCounts: facts.rowCounts,
        findings,
        verification: { status: blockingFindings === 0 ? "pass" : "fail", blockingFindings },
    };
}

/** Collects facts through `queryable` and returns the sealed report. The caller owns the read-only transaction. */
export async function collectPreflight(queryable: ReadOnlyQueryable, context: AnalysisContext): Promise<PreflightReport> {
    const facts = await collectFacts(queryable, context.target);
    return sealReport(analyzePreflight(facts, context));
}
