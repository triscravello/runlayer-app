-- Outfit item uniqueness and supporting indexes.
--
-- BEFORE applying this to any shared or hosted database, follow prisma/maintenance/README.md: run the read-only
-- duplicate detection first. This migration never removes or rewrites data. If duplicate (outfit_id, gear_item_id)
-- rows exist, the guard below stops it with a clear message and nothing is changed; remediation is a separate,
-- explicitly authorized step (prisma/maintenance/).
--
-- Prisma Migrate sends this whole file as one multi-statement script, which PostgreSQL runs as a single transaction,
-- so it either applies completely or not at all (verified on PostgreSQL 14 and 17). There is deliberately no explicit
-- transaction statement here: with one, Prisma reports "current transaction is aborted" and the guard's message below
-- never reaches the operator.

-- Bound how long this migration may wait for the table lock; if it times out, nothing has changed.
SET LOCAL lock_timeout = '15s';

-- Block concurrent writers for the (short) duration, so the guard and the unique index see the same rows.
LOCK TABLE "outfit_items" IN SHARE MODE;

-- Guard: refuse to continue if duplicates exist. Read-only.
DO $$
DECLARE
    duplicate_groups integer;
BEGIN
    SELECT count(*) INTO duplicate_groups
    FROM (
        SELECT 1
        FROM "outfit_items"
        GROUP BY "outfit_id", "gear_item_id"
        HAVING count(*) > 1
    ) AS duplicates;

    IF duplicate_groups > 0 THEN
        RAISE EXCEPTION 'outfit_items contains % duplicate (outfit_id, gear_item_id) group(s); nothing was changed. Review them and remediate with prisma/maintenance/ before applying this migration.', duplicate_groups;
    END IF;
END
$$;

-- CreateIndex
CREATE INDEX "saved_outfits_user_id_created_at_idx" ON "saved_outfits"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "outfit_items_gear_item_id_idx" ON "outfit_items"("gear_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "outfit_items_outfit_id_gear_item_id_key" ON "outfit_items"("outfit_id", "gear_item_id");
