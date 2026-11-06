// Shared fixtures for the offline deployment-guardrail tests. Everything here is synthetic: the "database" is a plain
// object, the host is the reserved .test domain, and the password is a recognizable sentinel the tests search for.
// Nothing in this file opens a connection.

import { fileURLToPath } from "node:url";
import { parseDatabaseTarget } from "./databaseTarget";
import { readMigrationSet } from "./migrationFingerprint";
import { analyzePreflight, type PreflightFacts } from "./preflightQueries";
import { sealReport, type PreflightReport } from "./preflightReport";

export const SENTINEL_PASSWORD = "s3cr3t-PASSWORD-sentinel";
export const TARGET_URL = `postgresql://svc:${SENTINEL_PASSWORD}@db.example.test:5432/appdb`;
export const TARGET = parseDatabaseTarget(TARGET_URL);
export const OTHER_URL = "postgresql://svc:other-pw@db.other.test:5432/appdb";
export const NOW = new Date("2026-11-06T12:00:00.000Z");

/** The repository's real migration set, so migration names and checksums are the real ones. */
export const MIGRATIONS = readMigrationSet(fileURLToPath(new URL("../../prisma/migrations", import.meta.url)));
export const MIGRATION_NAMES = MIGRATIONS.migrations.map((migration) => migration.name);
export const CONTEXT = { target: TARGET, migrationSet: MIGRATIONS, now: NOW };

const ALL_TABLES = ["_prisma_migrations", "brands", "gear_items", "outfit_items", "saved_outfits", "user_profiles", "users"];

export function historyFor(names: readonly string[]) {
    const checksums = new Map(MIGRATIONS.migrations.map((migration) => [migration.name, migration.checksum]));
    return names.map((name) => ({ name, checksum: checksums.get(name) ?? "0".repeat(64), finished: true, rolledBack: false }));
}

const identity = { database: "appdb", serverVersion: "17.10", inRecovery: false, isSuperuser: false, canCreate: false, canWrite: false };

/** A fully migrated, healthy database with two clean brands. */
export function currentFacts(overrides: Partial<PreflightFacts> = {}): PreflightFacts {
    return {
        identity: { ...identity },
        tables: [...ALL_TABLES],
        columns: [
            { table: "users", column: "session_version", nullable: false },
            { table: "brands", column: "normalized_name", nullable: false },
        ],
        indexes: ["outfit_items_outfit_id_gear_item_id_key", "outfit_items_gear_item_id_idx", "saved_outfits_user_id_created_at_idx", "brands_normalized_name_key"],
        history: historyFor(MIGRATION_NAMES),
        outfitDuplicates: { groups: 0, removableRows: 0 },
        brands: {
            keysStored: true,
            rows: [
                { id: "brand-1", name: "Nike", storedKey: "nike" },
                { id: "brand-2", name: "Adidas", storedKey: "adidas" },
            ],
        },
        gear: [
            { brandId: "brand-1", name: "Pegasus" },
            { brandId: "brand-2", name: "Adizero" },
        ],
        preferenceLists: [["SECRET-USER-PREFERENCE"]],
        rowCounts: { users: 3, brands: 2, gear_items: 2, saved_outfits: 1, outfit_items: 1 },
        ...overrides,
    };
}

/** The June-era schema (migrations 1 to 7 applied) with M8 to M10 still pending, and clean ASCII brands. */
export function behindFacts(overrides: Partial<PreflightFacts> = {}): PreflightFacts {
    return currentFacts({
        columns: [],
        indexes: [],
        history: historyFor(MIGRATION_NAMES.slice(0, 7)),
        brands: {
            keysStored: false,
            rows: [
                { id: "brand-1", name: "Nike" },
                { id: "brand-2", name: "Adidas" },
            ],
        },
        ...overrides,
    });
}

/** A brand-new, empty database. */
export function emptyFacts(overrides: Partial<PreflightFacts> = {}): PreflightFacts {
    return {
        identity: { ...identity },
        tables: [],
        columns: [],
        indexes: [],
        history: null,
        outfitDuplicates: null,
        brands: null,
        gear: [],
        preferenceLists: [],
        rowCounts: {},
        ...overrides,
    };
}

export function reportFor(facts: PreflightFacts): PreflightReport {
    return sealReport(analyzePreflight(facts, CONTEXT));
}

/** Re-seals a report after `mutate` edited its body, so only the intended property is wrong. */
export function resealed(report: PreflightReport, mutate: (body: Omit<PreflightReport, "reportDigest">) => void): PreflightReport {
    const { reportDigest, ...body } = structuredClone(report);
    void reportDigest;
    mutate(body);
    return sealReport(body);
}
