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
