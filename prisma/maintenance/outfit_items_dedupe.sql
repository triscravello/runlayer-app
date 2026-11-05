-- DESTRUCTIVE (reversible): removes duplicate (outfit_id, gear_item_id) rows from outfit_items, keeping one per group.
--
-- NEVER run this until you have run outfit_items_detect_duplicates.sql and reviewed outfit_items_dedupe_preview.sql.
-- It refuses to run unless you pass the confirmation variable explicitly:
--
--   psql "$TARGET_DATABASE_URL" -v confirm_dedupe=yes -f prisma/maintenance/outfit_items_dedupe.sql
--
-- What it does, all in ONE transaction (any failed check rolls everything back):
--   1. takes a lock that blocks concurrent writers to outfit_items;
--   2. refuses to continue if an earlier backup table already exists (it never overwrites a backup);
--   3. copies EXACTLY the rows to be removed into outfit_items_dedupe_backup, recording the surviving row (kept_id);
--   4. deletes ONLY the rows that are in that backup (the delete is joined to the backup by id, so it cannot touch any
--      other row);
--   5. verifies that no duplicates remain, that every survivor still exists and that every backed-up row is gone.
--
-- Keep-one rule (identical to outfit_items_dedupe_preview.sql): the survivor is the row with a non-null category, and
-- among equals the smallest id.
--
-- To undo: outfit_items_dedupe_restore.sql (only possible while the unique index does not exist yet).
-- The backup table is intentionally left in place; drop it yourself once you are satisfied (see the README).
\set ON_ERROR_STOP on

\if :{?confirm_dedupe}
\else
    \echo 'REFUSING TO RUN: pass -v confirm_dedupe=yes after reviewing outfit_items_dedupe_preview.sql.'
    \quit
\endif

SELECT (:'confirm_dedupe' = 'yes') AS confirmed \gset
\if :confirmed
\else
    \echo 'REFUSING TO RUN: confirm_dedupe must be exactly yes.'
    \quit
\endif

BEGIN;

LOCK TABLE outfit_items IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
    IF to_regclass('outfit_items_dedupe_backup') IS NOT NULL THEN
        RAISE EXCEPTION 'outfit_items_dedupe_backup already exists. Nothing was changed. Verify and drop (or rename) the old backup first.';
    END IF;
END
$$;

CREATE TABLE outfit_items_dedupe_backup AS
WITH ranked AS (
    SELECT id,
           outfit_id,
           gear_item_id,
           category,
           count(*) OVER (PARTITION BY outfit_id, gear_item_id) AS copies,
           row_number() OVER (PARTITION BY outfit_id, gear_item_id ORDER BY (category IS NULL), id) AS keep_rank
    FROM outfit_items
)
SELECT r.id,
       r.outfit_id,
       r.gear_item_id,
       r.category,
       k.id AS kept_id,
       now() AS backed_up_at
FROM ranked r
JOIN ranked k ON k.outfit_id = r.outfit_id AND k.gear_item_id = r.gear_item_id AND k.keep_rank = 1
WHERE r.copies > 1 AND r.keep_rank > 1;

DELETE FROM outfit_items o
USING outfit_items_dedupe_backup b
WHERE o.id = b.id;

DO $$
DECLARE
    remaining_groups integer;
    missing_survivors integer;
    rows_not_removed integer;
BEGIN
    SELECT count(*) INTO remaining_groups
    FROM (
        SELECT 1 FROM outfit_items GROUP BY outfit_id, gear_item_id HAVING count(*) > 1
    ) AS duplicates;

    SELECT count(*) INTO missing_survivors
    FROM outfit_items_dedupe_backup b
    WHERE NOT EXISTS (SELECT 1 FROM outfit_items o WHERE o.id = b.kept_id);

    SELECT count(*) INTO rows_not_removed
    FROM outfit_items_dedupe_backup b
    WHERE EXISTS (SELECT 1 FROM outfit_items o WHERE o.id = b.id);

    IF remaining_groups > 0 OR missing_survivors > 0 OR rows_not_removed > 0 THEN
        RAISE EXCEPTION 'dedupe verification failed (remaining groups %, missing survivors %, rows not removed %); rolling back.', remaining_groups, missing_survivors, rows_not_removed;
    END IF;
END
$$;

SELECT count(*) AS rows_backed_up_and_removed FROM outfit_items_dedupe_backup;

COMMIT;
