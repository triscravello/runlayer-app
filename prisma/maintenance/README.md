# Database maintenance scripts

These scripts are **not migrations**. `prisma migrate deploy` never runs them, and nothing in the application calls
them. They exist so that a risky data step is explicit, previewable and reversible. They are plain SQL for `psql`.

## Outfit item uniqueness (migration `20261105180000_add_outfit_item_constraints_and_indexes`)

The migration adds a unique index on `outfit_items (outfit_id, gear_item_id)` plus two supporting indexes. Older
versions of the app could write duplicate rows, so the migration begins with a **guard**: if any duplicate group exists
it stops with a clear message and changes nothing. The migration itself never deletes or rewrites data.

| Script | Effect |
|---|---|
| `outfit_items_detect_duplicates.sql` | Read only. Counts and lists duplicate groups. |
| `outfit_items_dedupe_preview.sql` | Read only. Shows every row as `KEEP` or `REMOVE`. |
| `outfit_items_dedupe.sql` | **Destructive but reversible.** Backs up, then removes, only the `REMOVE` rows. Needs `-v confirm_dedupe=yes`. |
| `outfit_items_dedupe_restore.sql` | Puts the backed-up rows back. Needs `-v confirm_restore=yes`. Refuses once the unique index exists. |

Use your own connection string through an environment variable (for example `TARGET_DATABASE_URL`); never paste it into
a file, ticket or chat.

### Order of operations

1. **Back up the database** with your provider's own tooling (snapshot or point-in-time recovery).
2. **Detect** (read only): `psql "$TARGET_DATABASE_URL" -f prisma/maintenance/outfit_items_detect_duplicates.sql`.
   If it reports `duplicate_groups = 0`, skip to step 6.
3. **Preview** (read only): `psql "$TARGET_DATABASE_URL" -f prisma/maintenance/outfit_items_dedupe_preview.sql`.
   Review every `REMOVE` row. The survivor of a group is the row with a non-null `category`, then the smallest `id`.
   Items behave as a set, so any survivor is equivalent.
4. **Remediate**, only after you have reviewed the preview and explicitly decided to proceed:
   `psql "$TARGET_DATABASE_URL" -v confirm_dedupe=yes -f prisma/maintenance/outfit_items_dedupe.sql`.
   It runs as one transaction, creates `outfit_items_dedupe_backup` (and refuses to overwrite an existing one), removes
   exactly the backed-up rows and verifies the result; any failed check rolls everything back.
5. **Re-run the detect script.** It must now report zero groups.
6. **Apply the migration** (`prisma migrate deploy`). On a clean or remediated database the guard passes and the
   indexes are created in one transaction.
7. Once you are satisfied, drop the backup yourself: `DROP TABLE outfit_items_dedupe_backup;`. Until then it shows up
   as an extra table if you compare the database with the Prisma schema.

### If the guard stops the migration

The migration is recorded as failed and Prisma will refuse further migrations until you resolve it (error P3009). The
schema is unchanged. Remediate (steps 3 to 5), then run
`prisma migrate resolve --rolled-back 20261105180000_add_outfit_item_constraints_and_indexes` and deploy again.
Running the detect script first avoids this.

### Rolling back

- **After remediation, before the migration:** run `outfit_items_dedupe_restore.sql` (`-v confirm_restore=yes`).
- **After the migration:** the indexes lose no data, so rolling back is a new migration that drops them:
  `DROP INDEX "outfit_items_outfit_id_gear_item_id_key"; DROP INDEX "outfit_items_gear_item_id_idx"; DROP INDEX "saved_outfits_user_id_created_at_idx";`
  Restore removed duplicates (if you want them back) only after that.

### Hosted databases

Do not run any of these against a hosted database as part of automated tooling. A hosted run (the read-only
detection first) is a separate, explicitly approved step performed with credentials you control.

### Tested on

PostgreSQL 14 and 17 (see `prisma/outfitConstraints.integration.test.ts`; opt-in, local disposable servers only).

## Brand identity (`brands.normalized_name`, migration `20261105200000_add_brand_normalized_name`)

Two brands that differ only by case, surrounding or repeated whitespace, or Unicode compatibility forms (`Nike`, `nike`,
` NIKE `, full-width `ＮＩＫＥ`) are the same brand. The application decides that with one function,
`normalizeBrandKey` in `lib/ingestion/brandResolution.ts` (NFKC, trim, collapse whitespace, lowercase). The migration adds
`brands.normalized_name`, backfills it, and makes it `NOT NULL UNIQUE`. `brands.name` stays unique too, and no `brands.id`
ever changes, so every `gear_items.brand_id` reference is untouched.

### What the database guarantees, and what it cannot

- **Guaranteed:** no two brands can store the same key, and no brand can be written without one. Concurrent creators of
  equivalent names end with exactly one row.
- **Not guaranteed:** that a writer computed the key *correctly*. The database compares stored text; it cannot recompute
  NFKC or JavaScript's lowercasing. A raw SQL `INSERT` can store any key, and a key that does not match the application's
  would make lookups miss the row. All application writers build the row with `toBrandIdentity()`, and a test scans the
  source to keep it that way; raw SQL writers must not exist (or must use the same rule).

### Database-side safeguards considered

| Safeguard | Decision |
|---|---|
| Unique index and `NOT NULL` on the stored key | In the migration. A writer that forgets the key fails loudly. |
| `CHECK` on the key's shape (non-empty, at most 100 characters, trimmed, no double spaces), written with literals only so it never depends on the locale | **Deferred.** Prisma does not model `CHECK` constraints, and whether `prisma migrate diff` reports them as drift could not be verified without a database. `prisma/brandConstraints.integration.test.ts` records the answer on PostgreSQL 14 and 17 as a diagnostic, so a later, separately approved step can add it with evidence. |
| A `CHECK`, trigger or generated column that recomputes the key in SQL | **Rejected.** It would have to reimplement NFKC and JavaScript's contextual lowercasing in PostgreSQL. PostgreSQL's `lower()` and `\s` depend on the database locale and differ from JavaScript (dotted capital I, Greek final sigma, no-break space), so it would reject keys that are correct. |
| Read-only audit that recomputes every stored key with the application's function | **Provided:** `scripts/brandKeyReport.ts`. After the migration it reports any row whose stored key differs. |
| Restrict `INSERT`/`UPDATE` on `brands` to the application's database role | Recommended operationally; it is a privilege setting outside this repository. |

### Order of operations before applying the migration anywhere shared or hosted

1. **Back up the database** with your provider's own tooling.
2. **Census (read only):** `psql "$TARGET_DATABASE_URL" -f prisma/maintenance/brands_detect_duplicates.sql`. Exact for
   printable ASCII; a hint for other names.
3. **Exact audit (read only):** `BRAND_AUDIT_DATABASE_URL=... npx tsx scripts/brandKeyReport.ts`. It uses the application's own
   function, runs in a read-only transaction, never reads `DATABASE_URL`, and prints only `host:port/database`. Exit code 0
   means clean, 2 means blocking findings. Which findings block depends on the database state, shown as
   `Database state:` in the report: **before** the migration (no `normalized_name` column) a name the ASCII SQL backfill
   cannot key is a blocking finding; **after** it, such a name is informational, because a valid non-ASCII brand with the
   correct stored key is healthy. In both states invalid names, groups of brands sharing one key, and stored keys that
   differ from the application's key block.
4. **If the report is clean**, go to step 6. **If it lists names the SQL backfill cannot key**, you need the JavaScript
   backfill below. **If it lists duplicate groups**, preview with `brands_merge_preview.sql` and follow the remediation plan below.
5. Re-run steps 2 and 3 until both are clean.
6. **Apply the migration** (`prisma migrate deploy`).
7. **Verify:** re-run `scripts/brandKeyReport.ts`; it must report zero stored-key mismatches and exit 0. Valid non-ASCII
   brands that the application created appear in its informational section and do not affect the exit code.

### If the migration stops

It stops before changing anything and Prisma shows the message (error P3018), for example
`brands contains 2 name(s) that are not printable ASCII …` or `brands contains 1 group(s) of names that normalize to the same
key …`. The whole script is one transaction, so the column and backfill are rolled back too. Prisma then records the
migration as failed and refuses further migrations (P3009) until you run
`prisma migrate resolve --rolled-back 20261105200000_add_brand_normalized_name`. Remediate first, then resolve, then deploy again.

### Existing non-ASCII names: the future JavaScript backfill (documented only, NOT implemented)

The migration refuses any name that is not printable ASCII, because only for printable ASCII is its SQL provably equal to
the JavaScript key. If your audit finds such names, the migration must be replaced by an expand / backfill / enforce
sequence, which needs its own approval:

1. **Expand** (migration): add `normalized_name TEXT` *nullable*, no constraints. Old and new application code both work.
2. **Backfill** (a script, to be written on approval): for each brand, compute `toBrandIdentity(name)`; in one
   transaction write ONLY `normalized_name` for rows where it is null; refuse, changing nothing, if any name is invalid or
   any two keys collide. It never edits `name`, never merges and never deletes.
3. **Enforce** (migration): guard against NULLs and duplicates with clear messages, then `SET NOT NULL` and create the unique
   index.

### Duplicate remediation plan (documented only, NOT implemented; needs separate explicit authorization)

Brands that already share a key must be resolved by a person's decision. A future script would follow the same safeguards as
the outfit-item remediation above:

- **Policy:** keep the brand that owns the most gear items (ties: oldest `created_at`, then smallest `id`); merge the others
  into it. `brands_merge_preview.sql` shows exactly this, read only.
- **Refuses** while any gear name exists under more than one brand of the group (it would collide on `gear_items
  (name, brand_id)`); those need a manual decision, because deleting gear cascades into saved outfits and recommendations.
- **Requires** an explicit confirmation variable, a lock, and one transaction.
- **Backs up first:** the affected brand rows and each repointed gear item's original `brand_id`, into backup tables; it never overwrites an
  existing backup.
- **Does:** repoint `gear_items.brand_id` to the canonical brand, then delete the now-empty duplicate brands (the
  `RESTRICT` foreign key makes that delete fail rather than orphan data), then verify and roll back on any failed check.
- **Never touches** user preference lists (they store names, not ids), recommendation data, or any other table.
- **Restore** puts the brand rows and gear `brand_id` values back from the backup, and refuses once the unique index exists.

### Deployment sequencing and its risks (no rollout is authorized yet)

| Sequence | What happens | Risk |
|---|---|---|
| **Migrate, then deploy** (the single migration as written) | Once the column is `NOT NULL`, the *old* application cannot create brands: admin create-brand, the CLI import and the seed fail until the new code is deployed. Reads keep working (the old client does not select the new column). | A short window in which brand creation errors. Rare, admin-only operations. |
| Deploy, then migrate | The *new* client selects `normalized_name` in every brand query, so every query touching brands, including gear listings, fails until the column exists. | Worse: breaks reads. Do not do this. |
| **Expand / backfill / enforce** (three steps) | Add a nullable column; deploy code that writes the key and tolerates NULL; backfill; then enforce `NOT NULL` and uniqueness. Both application versions work at every step. | No write window, but two migrations, two deploys and a temporarily nullable schema. |

The single migration is acceptable if a brief pause in creating brands is fine and the audit shows only printable-ASCII names.
Expand / backfill / enforce removes the interruption and is also the required path whenever the audit finds non-ASCII
names. The choice, the hosted preflight, the backup, the deployment and the rollback each need separate approval.

### Rolling back

The migration is forward-only. Undoing it is a new migration that drops `brands_normalized_name_key` and the
`normalized_name` column (no existing column or row is lost), together with reverting the application code that writes the key.

### Renaming a brand (not implemented; a rule for the future)

A rename must set `name` **and** `normalizedName` in one statement, both built with `toBrandIdentity()`. Updating only one
leaves the key stale. A test fails if any non-test source calls `brand.update`, `updateMany` or `upsert` with an `update`
that touches `name` without the key.

### Tested on

PostgreSQL 14 and 17 by `prisma/brandConstraints.integration.test.ts` (opt-in, local disposable servers only). It is written
and compiled but has not been run.
