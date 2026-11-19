# Disposable database preflight

`npm run db:disposable:check` and `npm run db:disposable:migrate` (`scripts/migrateDisposable.ts`) prepare a **throwaway local PostgreSQL**
database for the opt-in integration suites. They exist because a hand-written probe of Prisma's target once failed while the shell carried
on and ran the migration anyway (Stage 2B-G1). Nothing here replaces `npm run db:deploy` for hosted targets, and nothing weakens it.

## Inputs (explicit; `DATABASE_URL` and `.env` are never consulted)

| Variable | Meaning |
|---|---|
| `RUNLAYER_DISPOSABLE_URL` | `postgresql://USER[:PASSWORD]@127.0.0.1:PORT/runlayer_..._test_...` |
| `RUNLAYER_DISPOSABLE_DATA_DIR` | the absolute, canonical data directory of the throwaway cluster |
| `RUNLAYER_DISPOSABLE_ROOT` | the absolute directory that must contain that data directory (for example your scratch folder) |

`check` stops after verification. `migrate` (only through its npm script) continues to `prisma migrate deploy`.

## Gates, in order (the first failure stops everything after it)

1. **target**: literal loopback IP (`127.x.x.x` or `[::1]`; never `localhost`, never `127.1`/decimal/hex forms), an explicit port that is not
   5432 or 6543 and is at least 1024, a database name matching `runlayer_…_test_…` (`test` as a whole word), no query options except
   `schema=public` and `connect_timeout`, no host or address overrides, no repeated `@`.
2. **data_directory**: absolute and canonical (no `.`/`..`, doubled or trailing separators, whitespace), strictly inside the named root, not a
   well-known development location, and equal to its own `realpath` (no symlink).
3. **prisma_version**: the Prisma CLI must be `5.22.x`. Prisma 5.22 ignores `prisma.config.ts` and reads `DATABASE_URL` from `schema.prisma`; a
   different version may behave differently, so it fails closed until re-audited.
4. **port_owner** (no `ps`: it is setuid and cannot be executed under macOS `sandbox-exec`): `lsof` (absolute path, no shell, no fallback) must show
   exactly one process listening on the port, named `postgres`, bound only to loopback addresses that include the target's own host, on the
   target's port. Its current directory (a running postmaster `chdir`s into its data directory) must equal the expected data directory, and
   `<data directory>/postmaster.pid` must name the same pid, directory and port. The listeners are read again at the end and must be identical
   (process replacement). Codes: `port_inspection_unavailable` (lsof missing, denied, timed out or malformed output), `port_not_listening`,
   `port_owner_ambiguous`, `port_owner_not_postgres`, `port_listener_address_unexpected`, `port_owner_mismatch`, `postgres_identity_mismatch`,
   `port_owner_changed`.
5. **identity**: over a direct read-only `pg` session (no Prisma involved) the server must report the expected database, port, loopback
   address and data directory, hold no database other than `postgres` and the target, and contain only tables the schema defines.
6. **prisma_status**: `prisma migrate status`, run with the SAME environment object that `migrate deploy` will use, must state a datasource
   (database, schema `public`, `host:port`) equal to the target, print nothing that reports a problem, and end in a recognized state.
7. **migrate** (execute mode only): `prisma migrate deploy` with the byte-identical environment. A non-zero exit is a failure; there is no retry.

The Prisma child process gets an allowlisted environment: the parent's `DATABASE_URL` and every other parent variable are ignored, every key name
found in `.env` files is pre-defined as empty (Prisma copies a `.env` key only when it is undefined), `DATABASE_URL` is the single validated target,
and `CHECKPOINT_DISABLE`, `PRISMA_HIDE_UPDATE_MESSAGE` and `NO_UPDATE_NOTIFIER` are set. Prisma is started with `node`, never `npx`.

## What this does not do (read this)

- **It cannot prove a database is throwaway.** The expected data directory is the strongest machine-checkable evidence; a human still decides that
  the directory and the port really belong to a cluster created for the run.
- **It is not a network jail.** The environment variables above are requests, not enforcement, and the Node-level guard
  (`test-support/isolation/guard.cjs`) cannot see sockets opened by native code (the Prisma engines, `psql`, `pg_ctl`). Enforcement exists only
  when the whole workflow is started inside an OS-level jail (see "Network jail" below); the wrapper itself does not check that it is in one.
- **`prisma migrate status` output is parsed as text.** The "pending" and "up to date" wordings were confirmed against Prisma 5.22.0 in live runs
  (see "Validation record"); the unreachable-database wording has not been captured. Any unrecognized output fails closed.
- **Time of check, time of use.** The checks describe the server at one moment.
- **Port-owner residual risks.** `postmaster.pid` and cwd are observations, not proof: a hostile process could be started with the same name, directory
  and pid-file contents. Another user's process may be invisible to `lsof` (that fails closed as `port_not_listening`/unavailable). The live `lsof` +
  `-d cwd` behaviour under `sandbox-exec` was confirmed against a real PostgreSQL 14.19 postmaster (G1-S3B-2, G1-S3C).
- Raw `npx prisma migrate …` (and any raw `prisma migrate deploy`) remains possible and is NOT protected by this wrapper.

## Network jail (Stage G1-S3: validated by hand, NOT implemented in code)

An OS-level jail is the only enforcement that covers native code. It must wrap every stage command, including cluster start-up
(`initdb`/`pg_ctl`), this preflight, Prisma, the tests and `next dev`. Findings from the Stage G1-S audit (macOS `sandbox-exec`):

- A profile such as `(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(allow network-outbound (remote unix-socket))`
  gave `EPERM` for a connect to a non-routable address while a loopback connection worked.
- The wildcard form `(deny network*)` did **not** deny the outbound attempt. The profile syntax is fragile and needs its own test.
- **DNS still resolves under that profile** (the lookup goes through a system service reached over a Unix socket), so only the connection is
  blocked, not the name query. Closing it needs a deny rule for the DNS Mach service, which is untested.
- `sandbox-exec` is deprecated and macOS-only.

The jail must provide a **self-test that fails closed**: before any real work, a canary inside the jail must see an outbound connect to a
documentation-range address (192.0.2.1) fail with `EPERM` and a loopback connect succeed; otherwise abort. Open risks (unresolved):
DNS name leakage, native Prisma engine and `psql` traffic, and whether `next dev`/`next build` make registry or telemetry requests that must be
blocked rather than merely disabled.

## Execute-mode behavior (pinned by tests in `lib/testdb/disposableMigration.test.ts`)

The orchestration branches on `--execute` only, never on the Prisma state:

| mode | Prisma status | outcome |
|---|---|---|
| check | pending | gates pass, returns; `migrate deploy` is never run |
| check | up_to_date | gates pass, returns; `migrate deploy` is never run |
| execute | pending | `migrate status`, then `migrate deploy` exactly once (validated live) |
| execute | up_to_date | `migrate status`, then `migrate deploy` exactly once. Prisma is documented to treat this as a no-op, but it has **not** been run live |

An unrecognized status, a failed gate or a non-zero deploy stops the run; nothing is retried. Whether execute mode should skip `deploy` when
the state is `up_to_date` is an open design decision; the current behavior is deliberate and covered by tests.

## Validation record (all against throwaway clusters, inside a `sandbox-exec` jail, Prisma 5.22.0)

| Stage | What was shown |
|---|---|
| G1-S3B-2 | Live **check-only** run on a fresh PostgreSQL **14.19** cluster: all six gates passed, status `pending` (11 migrations), the real `lsof`/`postmaster.pid` port-owner check accepted the real listener, and wrong data directory, wrong or protected port, wrong database name and invalid host were all refused with no change to the database. |
| G1-S3C | Live **execute** run (`npm run db:disposable:migrate`) on a second fresh 14.19 cluster: all seven gates passed and **11 migrations applied successfully** (11 recorded, 0 failed, 0 rolled back; 13 tables matching the Prisma models; no application rows). A repeat `db:disposable:check` then reported **`up_to_date`** with an unchanged identity. |

Only PostgreSQL 14.19 has been validated. **PostgreSQL 17.x (including the local Postgres.app 17.10 server) has not been validated** with this
wrapper, and was never contacted.

## Remaining untested migration states

Execute mode against an `up_to_date` database; a partially migrated database; a failed or rolled-back migration (`_prisma_migrations` rows with
`finished_at` null); a database holding unknown tables (rejected by the identity gate in unit tests only); an unreachable database (the Prisma
wording was not captured); any PostgreSQL version other than 14.19; Prisma versions other than 5.22.x (refused by design). Schema equivalence was
checked by table names only, not columns, indexes or constraints.

## Limitations to keep in mind

- **DNS still resolves inside the `sandbox-exec` profile.** Only connections are blocked, so name queries (and anything encoded in them) can leave
  the machine. Closing that needs a Mach-service deny rule that has not been tried.
- **`sandbox-exec` is deprecated and macOS-only.** The profile syntax is fragile (`(deny network*)` did not work).
- **There is no in-code jail self-test.** Nothing in the wrapper detects that it is running outside a jail; the canary described above was run by hand.
- **Raw Prisma commands bypass everything here.** `npx prisma migrate deploy`, `migrate reset`, `db push` and the like remain possible and unguarded
  against any `DATABASE_URL`; only `npm run db:disposable:*` is protected.
