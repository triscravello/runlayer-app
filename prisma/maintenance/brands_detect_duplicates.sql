-- READ ONLY census of brand identity. Run it BEFORE applying the 20261105200000_add_brand_normalized_name migration to
-- any shared or hosted database (see prisma/maintenance/README.md, "Brand identity"). It changes nothing: the whole script is
-- one READ ONLY transaction that is rolled back at the end, and it works before and after the migration (it does not use
-- the new column).
--
--   psql "$TARGET_DATABASE_URL" -f prisma/maintenance/brands_detect_duplicates.sql
--
-- IMPORTANT - this is an APPROXIMATION. For printable-ASCII names the key below is EXACTLY the key the migration and the
-- application compute (the expression is the migration's). For any other name PostgreSQL's lower() and [[:space:]] depend
-- on the database locale and differ from JavaScript, so those names are listed in section 2 and their grouping here is
-- only a hint. The exact answer, for every name, comes from the application's own function:
--
--   BRAND_AUDIT_DATABASE_URL=... npx tsx scripts/brandKeyReport.ts
--
-- Zero names in section 2 and zero groups in section 3 means the migration can be applied as is.
BEGIN READ ONLY;

-- 1. Summary.
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
SELECT (SELECT count(*) FROM c) AS brands,
       (SELECT count(*) FROM c WHERE NOT ascii_clean OR btrim(name) = '' OR char_length(approx_key) > 100) AS names_the_sql_backfill_cannot_key,
       (SELECT count(*) FROM (SELECT approx_key FROM c GROUP BY approx_key HAVING count(*) > 1) AS d) AS approximate_duplicate_groups,
       (SELECT coalesce(sum(n - 1), 0) FROM (SELECT count(*) AS n FROM c GROUP BY approx_key HAVING count(*) > 1) AS d) AS brands_that_would_have_to_merge;

-- 2. Names the migration's SQL backfill refuses (need the JavaScript backfill).
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
SELECT id,
       name,
       CASE
           WHEN octet_length(name) <> char_length(name) THEN 'not ASCII'
           WHEN name ~ '[[:cntrl:]]' THEN 'control character'
           WHEN btrim(name) = '' THEN 'blank'
           ELSE 'key longer than 100 characters'
       END AS reason,
       char_length(name) AS characters,
       octet_length(name) AS bytes
FROM c
WHERE NOT ascii_clean OR btrim(name) = '' OR char_length(approx_key) > 100
ORDER BY name, id;

-- 3. Groups of brands that share a key, with how many gear items each one owns.
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
       c.id,
       c.name,
       count(g.id) AS gear_items,
       c.created_at
FROM c
LEFT JOIN gear_items g ON g.brand_id = c.id
WHERE c.approx_key IN (SELECT approx_key FROM c GROUP BY approx_key HAVING count(*) > 1)
GROUP BY c.approx_key, c.id, c.name, c.created_at
ORDER BY c.approx_key, c.name, c.id;

-- 4. Gear names that exist under more than one brand of a group. These would collide on gear_items (name, brand_id) if the
--    brands were merged, so they block an automatic merge and need a manual decision.
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

-- 5. User profiles that list an affected brand as preferred or avoided. Preferences store brand NAMES, not ids. A COUNT
--    only: no user is identified.
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
SELECT d.approx_key,
       (
           SELECT count(*)
           FROM user_profiles up
           WHERE EXISTS (
               SELECT 1
               FROM unnest(coalesce(up.preferred_brands, '{}') || coalesce(up.avoided_brands, '{}')) AS entry
               WHERE lower(btrim(entry)) IN (SELECT lower(btrim(m.name)) FROM c m WHERE m.approx_key = d.approx_key)
                  OR lower(regexp_replace(btrim(entry), '[[:space:]]+', ' ', 'g')) = d.approx_key
           )
       ) AS profiles_listing_it
FROM (SELECT approx_key FROM c GROUP BY approx_key HAVING count(*) > 1) AS d
ORDER BY d.approx_key;

ROLLBACK;
