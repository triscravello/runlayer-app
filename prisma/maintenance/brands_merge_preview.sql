-- READ ONLY preview of what merging duplicate brands WOULD involve. Nothing here changes data, and no merge script
-- exists yet: a confirmation-gated, backed-up merge is a separate step that needs its own explicit authorization (see
-- prisma/maintenance/README.md, "Duplicate remediation plan"). One READ ONLY transaction, rolled back at the end.
--
--   psql "$TARGET_DATABASE_URL" -f prisma/maintenance/brands_merge_preview.sql
--
-- Canonical-brand rule (what a future merge would keep): the brand that owns the most gear items; ties go to the oldest
-- (created_at), then the smallest id. Every other brand in the group would be merged INTO it: its gear items repointed to
-- the canonical brand and the now-empty brand removed. A merge is blocked while any gear name exists under more than one
-- brand of the group (section 3), and it never touches user preference lists.
--
-- Grouping uses the same APPROXIMATE key as brands_detect_duplicates.sql (exact for printable ASCII; a hint for anything
-- else - use scripts/brandKeyReport.ts for the exact grouping).
BEGIN READ ONLY;

-- 1. Row by row: which brand would be kept and which merged, and how many gear items would move.
WITH c AS (
    SELECT id,
           name,
           created_at,
           (octet_length(name) = char_length(name) AND name !~ '[[:cntrl:]]') AS ascii_clean,
           CASE
               WHEN octet_length(name) = char_length(name) AND name !~ '[[:cntrl:]]'
                   THEN translate(regexp_replace(btrim(name), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
               ELSE lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
           END AS approx_key
    FROM brands
),
counted AS (
    SELECT c.id, c.name, c.created_at, c.approx_key, count(g.id) AS gear_items
    FROM c
    LEFT JOIN gear_items g ON g.brand_id = c.id
    GROUP BY c.id, c.name, c.created_at, c.approx_key
),
ranked AS (
    SELECT counted.*,
           count(*) OVER (PARTITION BY approx_key) AS members,
           row_number() OVER (PARTITION BY approx_key ORDER BY gear_items DESC, created_at, id) AS canonical_rank,
           first_value(id) OVER (PARTITION BY approx_key ORDER BY gear_items DESC, created_at, id) AS canonical_id
    FROM counted
)
SELECT approx_key,
       id,
       name,
       gear_items,
       CASE WHEN canonical_rank = 1 THEN 'KEEP (canonical)' ELSE 'MERGE INTO ' || canonical_id END AS action
FROM ranked
WHERE members > 1
ORDER BY approx_key, canonical_rank;

-- 2. Totals.
WITH c AS (
    SELECT id,
           name,
           created_at,
           (octet_length(name) = char_length(name) AND name !~ '[[:cntrl:]]') AS ascii_clean,
           CASE
               WHEN octet_length(name) = char_length(name) AND name !~ '[[:cntrl:]]'
                   THEN translate(regexp_replace(btrim(name), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
               ELSE lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
           END AS approx_key
    FROM brands
),
counted AS (
    SELECT c.id, c.created_at, c.approx_key, count(g.id) AS gear_items
    FROM c
    LEFT JOIN gear_items g ON g.brand_id = c.id
    GROUP BY c.id, c.created_at, c.approx_key
),
ranked AS (
    SELECT counted.*,
           count(*) OVER (PARTITION BY approx_key) AS members,
           row_number() OVER (PARTITION BY approx_key ORDER BY gear_items DESC, created_at, id) AS canonical_rank
    FROM counted
)
SELECT count(*) FILTER (WHERE members > 1 AND canonical_rank = 1) AS duplicate_groups,
       count(*) FILTER (WHERE members > 1 AND canonical_rank > 1) AS brands_that_would_be_merged_away,
       coalesce(sum(gear_items) FILTER (WHERE members > 1 AND canonical_rank > 1), 0) AS gear_items_that_would_be_repointed
FROM ranked;

-- 3. BLOCKERS: gear names present under more than one brand of a group (they would collide on gear_items (name, brand_id)).
WITH c AS (
    SELECT id,
           name,
           created_at,
           (octet_length(name) = char_length(name) AND name !~ '[[:cntrl:]]') AS ascii_clean,
           CASE
               WHEN octet_length(name) = char_length(name) AND name !~ '[[:cntrl:]]'
                   THEN translate(regexp_replace(btrim(name), ' +', ' ', 'g'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
               ELSE lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
           END AS approx_key
    FROM brands
)
SELECT c.approx_key,
       g.name AS gear_name,
       array_agg(DISTINCT c.id ORDER BY c.id) AS brand_ids
FROM c
JOIN gear_items g ON g.brand_id = c.id
WHERE c.approx_key IN (SELECT approx_key FROM c GROUP BY approx_key HAVING count(*) > 1)
GROUP BY c.approx_key, g.name
HAVING count(DISTINCT c.id) > 1
ORDER BY c.approx_key, g.name;

ROLLBACK;
