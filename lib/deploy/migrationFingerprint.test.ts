import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MigrationSetError, computeMigrationSet, readMigrationSet, sha256Hex } from "./migrationFingerprint";

const LOCK = 'provider = "postgresql"\n';
const A = { name: "20260101000000_a", sql: "CREATE TABLE a ();" };
const B = { name: "20260102000000_b", sql: "CREATE TABLE b ();" };

test("the fingerprint is deterministic and independent of input order", () => {
    assert.equal(computeMigrationSet([A, B], LOCK).fingerprint, computeMigrationSet([B, A], LOCK).fingerprint);
    assert.match(computeMigrationSet([A, B], LOCK).fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(
        computeMigrationSet([B, A], LOCK).migrations.map((entry) => entry.name),
        [A.name, B.name],
    );
});

test("any change to the migration set changes the fingerprint", () => {
    const base = computeMigrationSet([A, B], LOCK).fingerprint;
    assert.notEqual(computeMigrationSet([A, { ...B, sql: `${B.sql} ` }], LOCK).fingerprint, base, "edited SQL");
    assert.notEqual(computeMigrationSet([A], LOCK).fingerprint, base, "removed migration");
    assert.notEqual(computeMigrationSet([A, B, { name: "20260103000000_c", sql: "" }], LOCK).fingerprint, base, "added migration");
    assert.notEqual(computeMigrationSet([A, { ...B, name: "20260102000000_renamed" }], LOCK).fingerprint, base, "renamed migration");
    assert.notEqual(computeMigrationSet([A, B], `${LOCK}# edited`).fingerprint, base, "edited lock file");
});

test("a migration checksum is the SHA-256 hex of its SQL", () => {
    assert.equal(computeMigrationSet([A], LOCK).migrations[0].checksum, createHash("sha256").update(A.sql).digest("hex"));
    assert.equal(sha256Hex("x"), createHash("sha256").update("x").digest("hex"));
});

function withDirectory(build: (dir: string) => void): string {
    const dir = mkdtempSync(join(tmpdir(), "runlayer-migrations-"));
    build(dir);
    return dir;
}

function writeMigration(dir: string, name: string, sql: string) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, "migration.sql"), sql);
}

test("readMigrationSet reads a well-formed directory", () => {
    const dir = withDirectory((d) => {
        writeMigration(d, A.name, A.sql);
        writeMigration(d, B.name, B.sql);
        writeFileSync(join(d, "migration_lock.toml"), LOCK);
    });
    try {
        assert.deepEqual(readMigrationSet(dir), computeMigrationSet([A, B], LOCK));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("readMigrationSet fails closed on anything unexpected", () => {
    const cases: Array<[string, (dir: string) => void]> = [
        ["stray file", (d) => { writeMigration(d, A.name, A.sql); writeFileSync(join(d, "migration_lock.toml"), LOCK); writeFileSync(join(d, "notes.txt"), "x"); }],
        ["stray directory", (d) => { writeMigration(d, A.name, A.sql); writeFileSync(join(d, "migration_lock.toml"), LOCK); mkdirSync(join(d, "scratch")); }],
        ["missing lock file", (d) => { writeMigration(d, A.name, A.sql); }],
        ["directory without migration.sql", (d) => { mkdirSync(join(d, A.name)); writeFileSync(join(d, "migration_lock.toml"), LOCK); }],
        ["no migrations", (d) => { writeFileSync(join(d, "migration_lock.toml"), LOCK); }],
    ];

    for (const [label, build] of cases) {
        const dir = withDirectory(build);
        try {
            assert.throws(() => readMigrationSet(dir), MigrationSetError, label);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    assert.throws(() => readMigrationSet(join(tmpdir(), "runlayer-does-not-exist-xyz")), MigrationSetError);
});

// Phase 3B must not alter any existing migration. These are the SHA-256 digests recorded before Phase 3B began. Adding a
// NEW migration later is fine (extra entries are allowed); editing or removing one of these is not.
const PINNED: Record<string, string> = {
    "20260528183058_add_user_roles": "73efe816161934b0cacc5fbe3d91f69b07cfb1de41cf68219ea7733a177ae368",
    "20260601163001_add_recommendation_history_feedback": "f228d08035799e1247bdf7fbc74adcb2bf3878472bb622faedbaeb7835bd6ee5",
    "20260602152307_personalization_saved_kits": "6bcc69bc1cd4d160a663f8328ffccd8fdabaf114e4c01edb1a37582287ee42c7",
    "20260603140249_recommendation_engine_versioning": "0270ac112fc6efc9e67671b13dac363df7680b0abe4313f81f32d40d9d43d3b0",
    "20260611190351_add_user_profile_location": "d81b43f026aec2d890ce35a038ccd49a054d6bb1e7a7d377601fef7a6391adda",
    "20260617180201_add_user_profile_gender_preference": "43bb1bb87b23b28e87b8690ebefe7b2afa9c67e06975dada332defb924c0f807",
    "20260629195746_add_gear_item_variants": "0a73d58b375525d070a76bb8f24f4f328b79818465b69cbefac78d3e1c32b9fd",
    "20261104160000_add_user_session_version": "113af74ca32ad869f5558649b4b87bbbff0cddc847b8a48d232ff133f55cfce5",
    "20261105180000_add_outfit_item_constraints_and_indexes": "c9cc1c11210f320f2a34707b212831f1ce80eb77c962920117d281f064965b32",
    "20261105200000_add_brand_normalized_name": "fe805b0f60830479cd206c0c277140b4abb90ff798db975492310e502f6fdc9a",
};
const PINNED_LOCK = "693566b52c49db47a2b0901d12400aa3d710d13a49f4a2a154b80c0505ed737c";

test("the repository's existing migrations are byte-for-byte unchanged", () => {
    const directory = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
    const set = readMigrationSet(directory);
    const byName = new Map(set.migrations.map((entry) => [entry.name, entry.checksum]));

    for (const [name, checksum] of Object.entries(PINNED)) assert.equal(byName.get(name), checksum, name);
    assert.ok(set.migrations.length >= Object.keys(PINNED).length);
    assert.equal(sha256Hex(readFileSync(join(directory, "migration_lock.toml"))), PINNED_LOCK);
});
