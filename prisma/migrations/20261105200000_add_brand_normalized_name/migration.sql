-- Brand identity: add brands.normalized_name (the application's normalized brand key) and make it unique.
--
-- BEFORE applying this to any shared or hosted database, follow prisma/maintenance/README.md ("Brand identity"): run the
-- read-only brand audit first. This migration never merges, renames or deletes a brand, never changes brands.id or
-- brands.name, and never touches gear_items or user preferences. If anything is unsupported or duplicated it stops with a
-- message and changes nothing; remediation is a separate, explicitly authorized step (prisma/maintenance/).
--
-- How the key is produced here. The application computes the key in JavaScript (normalizeBrandKey: NFKC, trim, collapse
-- whitespace, lowercase). PostgreSQL cannot reproduce that for arbitrary Unicode (lower() and \s depend on the database
-- locale and differ from JavaScript for characters such as the dotted capital I, the Greek final sigma and the
-- no-break space), so this migration backfills ONLY names for which the two provably agree: printable ASCII. For ASCII,
-- NFKC changes nothing, the only whitespace is the space, and lowercasing is the fixed A-Z to a-z mapping, applied below
-- with translate() so that it does not depend on any locale. A database holding any other name is refused (guard 1) and
-- needs the JavaScript backfill documented in prisma/maintenance/README.md.
--
-- Database uniqueness guarantees that no two brands store the same key. It cannot verify that a writer computed the key
-- correctly (a raw SQL insert can store any text); the read-only audit script recomputes every key to check that.
--
-- Prisma Migrate sends this whole file as one multi-statement script, which PostgreSQL runs as a single transaction, so it
-- either applies completely or not at all (verified for the Phase 2C migration on PostgreSQL 14 and 17). There is
-- deliberately no explicit transaction statement here: with one, Prisma reports "current transaction is aborted" and the
-- guard messages below never reach the operator.

-- Bound how long this migration may wait for the table lock; if it times out, nothing has changed.
SET LOCAL lock_timeout = '15s';

-- ADD COLUMN needs this lock anyway; taking it up front avoids a lock upgrade, and blocks concurrent brand writers so the
-- guards and the backfill see the same rows.
LOCK TABLE "brands" IN ACCESS EXCLUSIVE MODE;

-- Guard 1: every existing name must be one the SQL backfill can key exactly. Read-only.
DO $$
DECLARE
    unsupported integer;
BEGIN
    SELECT count(*) INTO unsupported
    FROM "brands"
    WHERE octet_length("name") <> char_length("name")
       OR "name" ~ '[[:cntrl:]]'
       OR btrim("name") = ''
       OR char_length(regexp_replace(btrim("name"), ' +', ' ', 'g')) > 100;

    IF unsupported > 0 THEN
        RAISE EXCEPTION 'brands contains % name(s) that are not printable ASCII, are blank, or produce a key longer than 100 characters; nothing was changed. List them with prisma/maintenance/brands_detect_duplicates.sql and use the JavaScript backfill described in prisma/maintenance/README.md before applying this migration.', unsupported;
    END IF;
END
$$;

-- AddColumn (nullable until it has been filled and validated).
ALTER TABLE "brands" ADD COLUMN "normalized_name" TEXT;

-- Backfill the NEW column only, for every row, with the ASCII-exact key.
UPDATE "brands"
SET "normalized_name" = translate(
    regexp_replace(btrim("name"), ' +', ' ', 'g'),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
);

-- Guard 2: no two brands may share a key. Read-only. (Nothing has been committed, so a failure undoes the column too.)
DO $$
DECLARE
    colliding_groups integer;
BEGIN
    SELECT count(*) INTO colliding_groups
    FROM (
        SELECT 1
        FROM "brands"
        GROUP BY "normalized_name"
        HAVING count(*) > 1
    ) AS collisions;

    IF colliding_groups > 0 THEN
        RAISE EXCEPTION 'brands contains % group(s) of names that normalize to the same key (case or whitespace variants); nothing was changed. Review them with prisma/maintenance/brands_detect_duplicates.sql and remediate (prisma/maintenance/README.md) before applying this migration.', colliding_groups;
    END IF;
END
$$;

-- AlterTable
ALTER TABLE "brands" ALTER COLUMN "normalized_name" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "brands_normalized_name_key" ON "brands"("normalized_name");
