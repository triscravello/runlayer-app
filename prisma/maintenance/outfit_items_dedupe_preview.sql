-- READ ONLY. Shows exactly which outfit_items rows the dedupe script WOULD remove and which would survive.
--
-- Run this and review it BEFORE running outfit_items_dedupe.sql. It changes nothing: one READ ONLY transaction,
-- rolled back at the end.
--
--   psql "$TARGET_DATABASE_URL" -f prisma/maintenance/outfit_items_dedupe_preview.sql
--
-- Keep-one rule (identical to outfit_items_dedupe.sql): within each (outfit_id, gear_item_id) group the survivor is
-- the row with a non-null category, and among equals the smallest id. The table has no created-at column, so no row is
-- meaningfully "older"; items behave as a set, so any survivor is equivalent.
BEGIN READ ONLY;

-- 1. Row by row: KEEP or REMOVE, for every row that belongs to a duplicate group. Rows not in a group are not listed.
WITH ranked AS (
    SELECT id,
           outfit_id,
           gear_item_id,
           category,
           count(*) OVER (PARTITION BY outfit_id, gear_item_id) AS copies,
           row_number() OVER (PARTITION BY outfit_id, gear_item_id ORDER BY (category IS NULL), id) AS keep_rank
    FROM outfit_items
)
SELECT outfit_id,
       gear_item_id,
       id,
       category,
       copies,
       CASE WHEN keep_rank = 1 THEN 'KEEP' ELSE 'REMOVE' END AS action
FROM ranked
WHERE copies > 1
ORDER BY outfit_id, gear_item_id, keep_rank;

-- 2. Totals.
WITH ranked AS (
    SELECT id,
           count(*) OVER (PARTITION BY outfit_id, gear_item_id) AS copies,
           row_number() OVER (PARTITION BY outfit_id, gear_item_id ORDER BY (category IS NULL), id) AS keep_rank
    FROM outfit_items
)
SELECT count(*) FILTER (WHERE copies > 1 AND keep_rank = 1) AS duplicate_groups,
       count(*) FILTER (WHERE copies > 1 AND keep_rank > 1) AS rows_that_would_be_removed,
       (SELECT count(*) FROM outfit_items) AS total_rows_now
FROM ranked;

ROLLBACK;
