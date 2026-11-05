-- READ ONLY. Detects duplicate (outfit_id, gear_item_id) rows in outfit_items.
--
-- Run this BEFORE applying the 20261105180000_add_outfit_item_constraints_and_indexes migration to any shared or
-- hosted database (see prisma/maintenance/README.md). It changes nothing: the whole script is one READ ONLY
-- transaction that is rolled back at the end.
--
--   psql "$TARGET_DATABASE_URL" -f prisma/maintenance/outfit_items_detect_duplicates.sql
--
-- Zero duplicate groups means the migration can be applied as is.
BEGIN READ ONLY;

-- 1. Summary.
SELECT count(*) AS duplicate_groups,
       coalesce(sum(copies - 1), 0) AS rows_that_remediation_would_remove
FROM (
    SELECT count(*) AS copies
    FROM outfit_items
    GROUP BY outfit_id, gear_item_id
    HAVING count(*) > 1
) AS groups;

-- 2. Every duplicate group.
SELECT outfit_id,
       gear_item_id,
       count(*) AS copies,
       array_agg(id ORDER BY id) AS row_ids,
       count(DISTINCT category) AS distinct_categories,
       bool_or(category IS NULL) AS has_null_category
FROM outfit_items
GROUP BY outfit_id, gear_item_id
HAVING count(*) > 1
ORDER BY copies DESC, outfit_id, gear_item_id;

-- 3. Informational only: items whose stored category differs from their gear item's category.
SELECT count(*) AS items_with_category_different_from_gear
FROM outfit_items oi
JOIN gear_items g ON g.id = oi.gear_item_id
WHERE oi.category IS DISTINCT FROM g.category;

ROLLBACK;
