// A fingerprint of the repository's Prisma migration set. The preflight records it and the guarded migration command
// recomputes it, so evidence collected for one set of migrations can never authorize a different set.
//
// Per-migration checksums are the SHA-256 (hex) of migration.sql, which is what Prisma stores in
// `_prisma_migrations.checksum`. That equivalence is Prisma's documented behavior but has not been observed against a
// real history table in this repository, so a mismatch is always treated as BLOCKING (fail closed) and the disposable
// rehearsal in the runbook is where the assumption gets confirmed.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type MigrationEntry = { name: string; checksum: string };

export type MigrationSet = {
    /** SHA-256 over the ordered (name, checksum) pairs and the lock file. Changes if any migration is added, removed, renamed or edited. */
    fingerprint: string;
    migrations: MigrationEntry[];
};

export class MigrationSetError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MigrationSetError";
    }
}

const FINGERPRINT_VERSION = "runlayer-migration-set-v1";
const MIGRATION_DIRECTORY = /^\d{14}_[A-Za-z0-9_]+$/;
const LOCK_FILE = "migration_lock.toml";

export function sha256Hex(content: string | Uint8Array): string {
    return createHash("sha256").update(content).digest("hex");
}

/** Pure: builds the set from (name, SQL) pairs and the lock file text. */
export function computeMigrationSet(migrations: ReadonlyArray<{ name: string; sql: string | Uint8Array }>, lockFile: string | Uint8Array): MigrationSet {
    const entries = migrations
        .map((migration) => ({ name: migration.name, checksum: sha256Hex(migration.sql) }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const lines = [FINGERPRINT_VERSION, ...entries.map((entry) => `${entry.name}:${entry.checksum}`), `${LOCK_FILE}:${sha256Hex(lockFile)}`];
    return { fingerprint: sha256Hex(lines.join("\n")), migrations: entries };
}

/**
 * Reads prisma/migrations. Fails closed on anything unexpected (a stray file, a directory without migration.sql, a name
 * that is not a Prisma timestamped migration) rather than silently ignoring it.
 */
export function readMigrationSet(directory: string): MigrationSet {
    let entries;
    try {
        entries = readdirSync(directory, { withFileTypes: true });
    } catch {
        throw new MigrationSetError("The migrations directory could not be read.");
    }

    const migrations: Array<{ name: string; sql: Uint8Array }> = [];
    let lockFile: Uint8Array | null = null;

    for (const entry of entries) {
        if (entry.isFile() && entry.name === LOCK_FILE) {
            lockFile = readFileSync(join(directory, entry.name));
            continue;
        }

        if (!entry.isDirectory() || !MIGRATION_DIRECTORY.test(entry.name)) {
            throw new MigrationSetError("The migrations directory contains an unexpected entry.");
        }

        try {
            migrations.push({ name: entry.name, sql: readFileSync(join(directory, entry.name, "migration.sql")) });
        } catch {
            throw new MigrationSetError("A migration directory has no readable migration.sql.");
        }
    }

    if (!lockFile) throw new MigrationSetError("migration_lock.toml is missing.");
    if (migrations.length === 0) throw new MigrationSetError("The migrations directory holds no migrations.");

    return computeMigrationSet(migrations, lockFile);
}
