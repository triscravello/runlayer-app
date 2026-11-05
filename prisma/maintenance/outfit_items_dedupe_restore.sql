-- REVERSES outfit_items_dedupe.sql: puts the removed rows back from outfit_items_dedupe_backup.
--
-- This only makes sense BEFORE the unique index exists (the restored rows are duplicates by definition). If the
-- migration has already been applied, this script refuses to run; to go back you would first apply a migration that
-- drops outfit_items_outfit_id_gear_item_id_key (see the README), and only then restore.
--
--   psql "$TARGET_DATABASE_URL" -v confirm_restore=yes -f prisma/maintenance/outfit_items_dedupe_restore.sql
--
-- It inserts only rows that are in the backup, never overwrites an existing row (ON CONFLICT (id) DO NOTHING), skips a
-- row whose outfit or gear item has since been deleted (the foreign keys would reject it), and leaves the backup table
-- in place.
\set ON_ERROR_STOP on

\if :{?confirm_restore}
\else
    \echo 'REFUSING TO RUN: pass -v confirm_restore=yes.'
    \quit
\endif

SELECT (:'confirm_restore' = 'yes') AS confirmed \gset
\if :confirmed
\else
    \echo 'REFUSING TO RUN: confirm_restore must be exactly yes.'
    \quit
\endif

BEGIN;

LOCK TABLE outfit_items IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF to_regclass('outfit_items_dedupe_backup') IS NULL THEN
        RAISE EXCEPTION 'outfit_items_dedupe_backup does not exist; there is nothing to restore.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = 'outfit_items_outfit_id_gear_item_id_key'
    ) THEN
        RAISE EXCEPTION 'the unique index outfit_items_outfit_id_gear_item_id_key exists; restoring duplicate rows would violate it. Nothing was changed.';
    END IF;
END
$$;

INSERT INTO outfit_items (id, outfit_id, gear_item_id, category)
SELECT b.id, b.outfit_id, b.gear_item_id, b.category
FROM outfit_items_dedupe_backup b
WHERE EXISTS (SELECT 1 FROM saved_outfits s WHERE s.id = b.outfit_id)
  AND EXISTS (SELECT 1 FROM gear_items g WHERE g.id = b.gear_item_id)
ON CONFLICT (id) DO NOTHING;

SELECT (SELECT count(*) FROM outfit_items_dedupe_backup) AS rows_in_backup,
       (SELECT count(*) FROM outfit_items o JOIN outfit_items_dedupe_backup b ON b.id = o.id) AS backup_rows_present_now;

COMMIT;
