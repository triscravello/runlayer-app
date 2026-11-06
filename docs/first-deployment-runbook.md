# RunLayer first-deployment runbook

RunLayer has **never been deployed**. Its Supabase database may nevertheless contain data, and it must be treated as
persistent and protected. This runbook describes how to take the application live for the first time, database first,
application second.

**Status of this document.** Written in Phase 3B. **Nothing in it has been executed against any real database.** Every
command below is a template for a later, separately authorized step. Facts are marked **[verified]** (checked in this
repository), **[reported]** (stated by the maintainer, not checkable from the repository) or **[unknown]** (must be
established by the operator before the step it affects).

## 1. Verification levels

Three different things are easy to confuse. Only the first has happened.

| Level | What it shows | Status |
|---|---|---|
| **A. Disposable local verification** | The Phase 2D migration (`20261105200000_add_brand_normalized_name`) and its guards behave correctly on PostgreSQL 14.19 and 17.10 databases built from scratch. | **[reported]** passed. Run logs are not stored in the repository. |
| **B. Restored-data rehearsal** | The full migration set applies, in order, to a *copy of the real hosted data*, and the preflight and smoke tests pass against it. | **Not done.** Required by step 6. |
| **C. Hosted migration** | The real Supabase database is migrated. | **Not done and not authorized.** Step 7. |

A pass at level A says nothing about the contents of the hosted database: it may hold duplicate outfit items, brand
collisions, non-ASCII brand names, a partial migration history, or schema drift. Level B is the first time those are
exercised, and it is the gate before level C. The Phase 2D migration **has not been applied to hosted Supabase**.

## 2. What the guardrails are, and what they are not

| Command | Effect on a database |
|---|---|
| `npm run db:preflight -- --out <file>` | **Read only.** One `READ ONLY` transaction with bounded timeouts; writes a report file. Creates no role, schema, table, index or temporary object. |
| `npm run db:deploy -- --evidence <file>` | **None.** Runs every guard and stops. It cannot migrate. |
| `npm run db:deploy:execute -- --evidence <file>` | Runs `prisma migrate deploy` against the approved target, only after every guard passes. The only path that can change a database. |

All three read their target from variables that exist **only for these commands**. None reads `DATABASE_URL`, none reads
`.env`, and none accepts arguments to forward to Prisma.

| Variable | Used by | Meaning |
|---|---|---|
| `RUNLAYER_PREFLIGHT_TARGET_URL` | preflight | Connection URL to inspect. Prefer a dedicated read-only role. |
| `RUNLAYER_MIGRATE_TARGET_URL` | migrate | Connection URL to migrate. Direct or session-mode, never a transaction pooler. |
| `RUNLAYER_DB_ALLOWED_TARGETS` | both | Exact `host:port/database` entries the operator approves. No wildcards or patterns. |
| `RUNLAYER_MIGRATE_CONFIRM_TARGET` | migrate | The target's `host:port/database`, typed again (the database name alone is not accepted: hosted providers often name every database `postgres`). |
| `RUNLAYER_MIGRATE_EVIDENCE_MAX_AGE_MINUTES` | migrate | Optional, 1 to 240. Default 30. |

Set them in the shell for one command, from a secret store. Never in `.env`.

**Exit codes.** Preflight: 0 passed, 2 blocking findings (the report is still written), 1 could not run. Migrate: 0 guards
passed (check) or Prisma succeeded, 3 refused by a guard, 1 could not run; any other value is Prisma's own exit status,
passed through unchanged along with Prisma's own output (including P3018 and P3009 messages).

### What the target guard refuses

Missing, malformed, wildcard, multi-host or doubled-`@` URLs; any scheme but `postgresql://` or `postgres://`; connection
options that could redirect the connection (`host`, `hostaddr`, `port`, `dbname`, `options`, `service`, `user`,
`password`, and anything not on a short allowlist of harmless options); duplicated options; transaction poolers (port
6543 or `pgbouncer=true`); a target that is not an exact allowlist entry; a confirmation that is not the exact
`host:port/database`. Every message is fixed text. None contains the URL, host, user or password.

### Bypass paths and limitations (read this)

1. **The wrapper does not stop direct Prisma use.** `npx prisma migrate deploy`, `migrate dev`, `migrate reset`, `db push`
   and `db execute` act on whatever `DATABASE_URL` the shell or `.env` supplies. **[verified]** Prisma 5.22's CLI loads
   `.env` itself, and a variable already set in the process wins over `.env`.
2. **Keep production credentials out of the ordinary development environment.** The local `.env` appears to name a
   Supabase host **[verified by a pattern count only; the value was not read]**. Replace it with a local development
   database, and keep the hosted URL in a secret store.
3. **`prisma.config.ts` is inert on Prisma 5.22** **[verified: the CLI contains no reference to it; `dotenv` is not installed]**.
   If Prisma is upgraded to a version that honors it, re-check that it cannot redirect migrations.
4. **Direct `psql`.** The maintenance scripts in `prisma/maintenance/` are plain SQL. Two of them
   (`outfit_items_dedupe.sql`, `outfit_items_dedupe_restore.sql`) write. They are guarded by confirmation variables, not by
   this wrapper.
5. **The evidence report is not a signature.** Its digest catches accidental damage and hand edits; anyone who can write the
   file can recompute it. It is evidence for a careful operator, not a barrier against a hostile one.
6. **A server cannot confirm its own host name.** The preflight verifies the database *name* the server reports. An SSH
   tunnel or port-forward that makes a different server answer under the allowlisted name is not detectable from inside.
7. **The wrapper is not a deployment gate.** Nothing prevents a hosting platform from building and starting the app. See step 1.

### Time of check, time of use

A preflight describes the database at one moment. Between that moment and the migration, a writer can add a duplicate
outfit item or a colliding brand. The design bounds this and does not remove it:

- Evidence older than 30 minutes (configurable, never more than 240) is refused.
- The operator re-types the target at execution time, immediately before the run.
- The migrations' own guards (`outfit_items` duplicates, unsupported or colliding brand names) run **inside** the migration
  transaction and fail closed, so a late change makes the migration refuse rather than corrupt data. Prisma then records a
  failure that must be resolved (see step 11).
- Quiesce writers (step 7) so the window has nobody in it.

### Evidence report (version 1)

JSON, no credentials and no personal data (brand ids and counts only, never brand names, user data or preferences):
`reportVersion`, `tool`, `collectedAt` (UTC), `target` (key `host:port/database`, reported database name, server version,
`inRecovery`, `identityVerified`, `readOnlyTransaction`), `role` (superuser, can-create, can-write), `migrationSet`
(SHA-256 fingerprint of every migration's checksum plus the lock file, count, names), `schema` (state, applied, pending,
failed, unknown-applied, checksum mismatches, tables present), `audits` (outfit duplicates, brand collisions and name support,
stored-key mismatches, preference counts, session-version column), `rowCounts`, `findings` (each `blocking`, `warning` or
`info`), `verification` (`pass` or `fail`, blocking count) and `reportDigest`.

**Schema states.** Migratable: `empty`, `behind`, `current`. Never migratable until a person resolves it: `untracked`
(tables but no `_prisma_migrations`; Prisma P3005), `failed_migration` (P3009), `diverged` (history, checksums or order
disagree with the repository), `drift` (objects disagree with the history).

The migration checksum comparison assumes Prisma stores the SHA-256 of `migration.sql` in `_prisma_migrations.checksum`.
**[unknown until step 6]**: a false mismatch would block (safe), and the rehearsal confirms the assumption.

## 3. The steps

### Step 1. Hosting provider and automatic-deployment verification

*Goal: nothing deploys the application before the database is ready.*

1. Choose and record the hosting provider **[unknown]**. The repository contains no `.github/`, `vercel.json` or Dockerfile.
2. Establish whether the provider builds and starts on every push to `main`. Phase 2D is already on GitHub
   **[verified]**, so a Git integration connected today would deploy it immediately. Connect the repository to the host
   only after step 7, or connect with automatic deployment **disabled** and promote manually.
3. Confirm the build command does not run migrations. **[verified]** `npm run build` is `next build`; `postinstall` is
   `prisma generate`, which needs no database.
4. Evidence to record: provider, project, branch binding, and a screenshot or export showing automatic deployment is off.

### Step 2. Supabase target identification

1. Record the project, region, database name, PostgreSQL major version, and plan **[unknown]**.
2. Obtain two connection strings and keep them apart: one **direct or session-mode (port 5432)** for migrations and the
   preflight, one for the application. Transaction-mode poolers (port 6543, `pgbouncer=true`) break Prisma's migration
   locking and are refused by the tooling. **[unknown]** which string the application should use at runtime; the schema
   has no `directUrl` (a possible Phase 3C change, not made here).
3. Write the allowlist entry as `host:port/database` and have a second person confirm it.
4. List every other client of this database **[unknown]**: other applications, dashboards, BI tools, cron jobs, Supabase
   Data API or Realtime consumers. The repository contains none, which says nothing about systems outside it. Check the
   provider's connection and API logs.

### Step 3. Read-only preflight

Prefer a dedicated read-only role (creating one is a change to the hosted database and needs its own authorization):

```sql
-- TEMPLATE. Not executed. Requires explicit approval.
CREATE ROLE runlayer_preflight LOGIN PASSWORD '<generated, kept in a secret store>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE runlayer_preflight SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE <database> TO runlayer_preflight;
GRANT USAGE ON SCHEMA public TO runlayer_preflight;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO runlayer_preflight;
```

The preflight discovers tables and columns through `pg_catalog`, which every role can read, so a missing `SELECT` grant
can never make a populated schema look empty. It makes a later query fail loudly instead.

```bash
RUNLAYER_PREFLIGHT_TARGET_URL='…' RUNLAYER_DB_ALLOWED_TARGETS='host:5432/db' \
  npm run db:preflight -- --out preflight-<date>.json
```

What it does, in order: parses and allowlist-checks the target; connects; opens one `READ ONLY` transaction with
`statement_timeout` 15 s, `lock_timeout` 3 s, `idle_in_transaction_session_timeout` 60 s; **verifies the session is read-only
and that the server reports the target's database name before collecting anything else**; then inspects migration history
(only if `_prisma_migrations` exists), failed migrations, the columns and indexes the pending migrations create, duplicate
outfit items, brand key collisions, names the SQL backfill cannot key, stored keys after the migration, and preference
counts. It never queries a table or column that does not exist.

Review every `blocking` and `warning` finding. `role_*` warnings mean the credentials can write; replace them. The report
file is git-ignored (`preflight-*.json`).

### Step 4. Migration prerequisites

Do not proceed unless all hold:

- [ ] Schema state is `empty`, `behind` or `current`.
- [ ] Zero duplicate outfit-item groups (or remediated and re-checked).
- [ ] Zero brand key collisions and zero invalid names.
- [ ] No non-ASCII brand names before the key column exists (or the JavaScript backfill path was separately approved).
- [ ] Server major version is 14 or 17, or the warning was reviewed and the rehearsal covered that version.
- [ ] No unknown writers (step 2.4), and a plan to quiesce the known ones (step 7).
- [ ] Production environment values verified (step 9) so the application can start the moment the database is ready.

### Step 5. Backup and restore verification

1. Take a provider backup or restore point immediately before the migration window **[unknown]**: plan, retention and
   point-in-time recovery availability must be confirmed in the dashboard, not assumed.
2. Take a logical dump as well (`pg_dump -Fc`), at least of `users`, `brands`, `gear_items`, `outfit_items`,
   `saved_outfits`, `user_profiles` and `_prisma_migrations`.
3. **A backup is only a backup once restored.** Restore into a disposable local PostgreSQL and compare row counts with the
   preflight's `rowCounts`. Record the date, the dump's checksum, and who verified it.

### Step 6. Disposable restored-data rehearsal (level B)

On the restored copy only:

1. Run the preflight against the copy, then `db:deploy:execute` with the copy's own allowlist entry. The target is local.
2. Run the Phase 2C and 2D integration tests against it (they are opt-in and local-only; see their headers).
3. Re-run the preflight: state `current`, zero stored-key mismatches (`scripts/brandKeyReport.ts` agrees).
4. Start the application against the migrated copy with the production environment shape (step 9) and run the smoke tests
   (step 10).
5. Confirm the checksum assumption: the preflight must not report `migration_checksum_mismatch` against a history that
   `prisma migrate deploy` itself wrote.
6. Record timings (lock hold, index builds) so the real window can be sized.

### Step 7. Explicit migration authorization

Separate approval, naming the target, the migration set fingerprint and the window. Then:

1. Quiesce writers, or confirm there are none. (There is no deployed application, which helps; external clients are the
   unknown.)
2. Fresh backup (step 5) and a fresh preflight against the real target, within the evidence age limit.
3. Check mode first. It must report "NOTHING WAS EXECUTED":

   ```bash
   RUNLAYER_MIGRATE_TARGET_URL='…' RUNLAYER_DB_ALLOWED_TARGETS='host:5432/db' RUNLAYER_MIGRATE_CONFIRM_TARGET='host:5432/db' \
     npm run db:deploy -- --evidence preflight-<date>.json
   ```

4. Execute, only after the operator has authorized this step, with the same variables:

   ```bash
   npm run db:deploy:execute -- --evidence preflight-<date>.json
   ```

5. Verify: re-run the preflight (state `current`, no blocking findings), then `scripts/brandKeyReport.ts` (exit 0).

### Step 8. Database-first application deployment

Only after step 7 verification. The application requires the final schema: the Phase 2D build selects `users.session_version`
and `brands.normalized_name` in almost every path, so deploying it against an older schema fails sign-in and every
brand-joining read. With the database already final and no earlier application live, there is no mixed-version window.

1. Deploy the Phase 2D commit (`a5cb420…` or later) to the host.
2. Everyone signs in once: tokens are four-part and no earlier token exists in production.

### Step 9. Production environment verification

At server start with `NODE_ENV=production`, `instrumentation.ts` runs `validateEnv`. On an invalid configuration the process prints
the problems (variable names and rules, never the values) to stderr and **exits with status 1**; it does not stay up. (Throwing
is not enough: Next.js 16 has already bound the port by then and swallows a failure in the hook, so a thrown error would leave
the server listening and answering every request with HTTP 500. The hook therefore exits explicitly.) It does not run in
development, in tests, or during `next build`. A host that restarts crashed processes will therefore restart-loop on a bad
configuration: watch for repeated exits, not for 500s. Confirm, in the host's settings (values never pasted into tickets or chat):

- `BETTER_AUTH_SECRET`: at least 32 characters, freshly generated, not the development fallback.
- `DATABASE_URL`: the application's runtime URL.
- `WEATHER_API_KEY`: set.
- `RATE_LIMIT_BACKEND`: `memory` or `upstash`; `upstash` also needs both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
  `memory` is per-process and not sufficient for several instances.
- `CLIENT_IP_STRATEGY`: matches the host's real proxy chain (a wrong value selects a proxy address or a client-controlled value).
- `METRICS_TOKEN`: valid (32 to 256 characters of letters, digits and `- . _ ~ + /`) or deliberately unset (endpoint returns 404).
- No migration-variable (`RUNLAYER_MIGRATE_*`, `RUNLAYER_PREFLIGHT_*`, `RUNLAYER_DB_ALLOWED_TARGETS`) and no admin database
  URL is present on the host.

### Step 10. Post-deployment smoke tests

Use a throwaway account, and record how it is removed.

- [ ] The server starts and stays up (an immediate exit with status 1 means step 9 is wrong; read the listed problems in the
      process's stderr).
- [ ] `/api/metrics`: 404 without a token (or with none configured), 200 with the bearer token.
- [ ] Sign up and sign in set a session cookie; a protected page loads.
- [ ] Sign out, then replay the old cookie: rejected.
- [ ] Gear listing returns brand names (exercises `brands.normalized_name`).
- [ ] Save an outfit with the same item twice: stored once.
- [ ] Admin create-brand with a case variant of an existing brand returns the existing brand, not a twin.
- [ ] A recommendation request succeeds (weather key and engine).
- [ ] Logs contain no connection strings, tokens or passwords.

### Step 11. Failure recovery and rollback decision points

| Where | What happened | Decision |
|---|---|---|
| Steps 3–4 | A blocking finding | Stop. Nothing has changed. Remediate with separately authorized tooling, then collect fresh evidence. |
| Step 7, guard refusal (exit 3) | A guard said no | Nothing ran. Read the listed reasons; fix the input, not the guard. |
| Step 7, Prisma **P3018** | A migration's own guard or SQL failed | The migration ran as one transaction, so the schema is unchanged for that migration, but earlier migrations in the same run stay applied. Read the message (counts only). Remediate the data. |
| Then **P3009** | Prisma refuses further migrations while a failed one is unresolved | After remediation: `prisma migrate resolve --rolled-back <name>` against the **explicit target** (set `DATABASE_URL` for that one command; the wrapper does not run `resolve`), then run the guarded path again with fresh evidence. **Never** `--applied` unless the schema was verified to match. |
| Connection lost mid-run | PostgreSQL rolls the transaction back and frees Prisma's advisory lock; the history may show an unfinished row | Treat as P3009. Run the preflight (it reports `failed_migration`) and resolve as above. |
| Step 8–10 | Application fails after a successful migration | Do **not** roll the schema back reflexively: the migrations are additive and lose no data. Fix forward, or redeploy the previous build if one exists. If a schema rollback is truly required, it is a new, reviewed migration (drop `brands_normalized_name_key` and `normalized_name`; drop the three outfit indexes; drop `users.session_version` only after reverting the code), and a restore from the step 5 backup is the last resort. |
| Data damage suspected | | Stop writers. Restore from the verified backup into a new database, compare, and switch over deliberately. |

## 4. Findings and the action each one needs

| Finding code | Meaning | Action |
|---|---|---|
| `schema_untracked_nonempty` | Tables but no migration history | A person decides how to baseline. Do not run `migrate deploy`. |
| `migration_failed_unresolved` | Unresolved failed migration | Step 11 (P3009). |
| `migration_history_diverged`, `migration_checksum_mismatch`, `migration_out_of_order` | History disagrees with the repository | Stop. Find out who changed what. |
| `schema_missing_objects`, `schema_unexpected_objects` | Schema disagrees with history | Stop. Decide whether to correct the schema or the history. |
| `outfit_duplicates_present` | Duplicate `(outfit_id, gear_item_id)` rows | Preview, then authorized dedupe (`prisma/maintenance/`), then re-run the preflight. |
| `brand_key_collisions` | Brands that are the same brand | Merge by a person. No merge script exists. Empty duplicates can be removed; gear-name conflicts need a manual decision. |
| `brand_names_unsupported_for_sql_backfill` | Non-ASCII, blank or control-character names | The single migration will refuse. The expand, backfill, enforce path is required and does not exist yet. |
| `brand_invalid_names` | Names the application would never accept | Correct or remove by a person. |
| `brand_stored_key_mismatch` | Stored key differs from the application's | Investigate the writer that produced it. |
| `server_in_recovery` | Target is a replica | Wrong target. |
| `server_major_not_verified`, `role_*` | Warnings | Review; rehearse on that version; use a read-only role. |

## 5. Open unknowns

Hosted migration state and contents; hosting provider and its deployment trigger; other database clients; the correct
Supabase connection string for migrations and for runtime; backup and point-in-time-recovery availability; role statement
timeouts; whether Prisma's checksum equals the SHA-256 of `migration.sql`; whether the hosted PostgreSQL major version is
14 or 17; stale statements elsewhere in `README.md` ("Deployment Readiness" quotes a 14/14 test count) that this phase did
not edit.
