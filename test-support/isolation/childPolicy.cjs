"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS: loaded by the child-guard preload, which runs before any ES module */
// The policy for a PRISMA CLI CHILD PROCESS started by an integration suite (see prismaChild.ts and child-guard.cjs). Pure: it receives
// the environment and arguments as parameters. Results carry short codes only; no URL, credential or path from the input is echoed.
//
// This is deliberately NOT a mode of guard.cjs. guard.cjs keeps its behavior (every process it loads into gets the unreachable sentinel
// DATABASE_URL); a child that must reach one scratch database is started WITHOUT that guard and WITH child-guard.cjs, which accepts
// exactly one narrow configuration and refuses everything else.

const { checkScratchTarget, parseStrictTarget } = require("./target.cjs");

const OPT_IN_NAME = "RUNLAYER_CHILD_ISOLATION";
const OPT_IN_VALUE = "prisma-cli";

/** The only NODE_OPTIONS a child may have: the child guard, and nothing else. */
const expectedNodeOptions = (guardPath) => `--require ${JSON.stringify(guardPath)}`;

// Names that can carry a hosted or PostgreSQL connection. In the child they must be absent or empty, except the two the policy names.
const CONNECTION_NAME = /(DATABASE|POSTGRES|REDIS|SUPABASE|UPSTASH|MONGO|MYSQL)/i;
const CONNECTION_NAMES = new Set(["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGSSLMODE", "PGPASSFILE", "PGOPTIONS", "DIRECT_URL", "SHADOW_DATABASE_URL", "WEATHER_API_KEY", "METRICS_TOKEN"]);
const ALLOWED_CONNECTION_VARIABLES = new Set(["DATABASE_URL", "RUNLAYER_TEST_DATABASE_URL"]);
const isConnectionVariable = (name) => CONNECTION_NAME.test(name) || CONNECTION_NAMES.has(name) || name.startsWith("RUNLAYER_MIGRATE_") || name.startsWith("RUNLAYER_PREFLIGHT_") || name.startsWith("RUNLAYER_DISPOSABLE_") || name === "RUNLAYER_DB_ALLOWED_TARGETS";

/**
 * The child's environment must opt in explicitly, carry exactly the expected NODE_OPTIONS, name a valid base target in
 * RUNLAYER_TEST_DATABASE_URL and a scratch database derived from it in DATABASE_URL, and hold no other connection variable.
 */
function checkChildEnvironment(env, guardPath) {
  if (env[OPT_IN_NAME] !== OPT_IN_VALUE) return { ok: false, code: "child_opt_in_missing" };
  if (env.NODE_OPTIONS !== expectedNodeOptions(guardPath)) return { ok: false, code: "child_node_options_unexpected" };
  const scoped = checkScratchTarget(env.RUNLAYER_TEST_DATABASE_URL, env.DATABASE_URL);
  if (!scoped.ok) return { ok: false, code: scoped.code };
  for (const name of Object.keys(env)) {
    if (ALLOWED_CONNECTION_VARIABLES.has(name) || !isConnectionVariable(name)) continue;
    if (env[name] !== undefined && env[name] !== "") return { ok: false, code: "child_connection_variable_present" };
  }
  return { ok: true, base: scoped.base, scratch: scoped.scratch };
}

// --- the approved Prisma operations ---------------------------------------------------------------------------------------------------

const MIGRATION_NAME = /^\d{14}_[a-z0-9_]{1,100}$/;
const OPERATIONS = {
  deploy: { flags: { "--schema": "path" }, required: ["--schema"] },
  status: { flags: { "--schema": "path" }, required: ["--schema"] },
  resolve: { flags: { "--rolled-back": "migration", "--schema": "path" }, required: ["--rolled-back", "--schema"] },
  diff: { flags: { "--from-migrations": "path", "--from-url": "url", "--to-schema-datamodel": "path", "--shadow-database-url": "url", "--exit-code": "none" }, required: ["--to-schema-datamodel", "--exit-code"] },
};

const isPlainPath = (value) => typeof value === "string" && value.length > 1 && value.length <= 1024 && value.startsWith("/") && !/[\u0000-\u001f\u007f]/.test(value) && !value.split("/").some((part) => part === "..");

/**
 * Accepts only: `migrate deploy|status --schema <path>`, `migrate resolve --rolled-back <migration> --schema <path>`, and
 * `migrate diff` with exactly one of --from-migrations (which requires --shadow-database-url) or --from-url (which forbids it), plus
 * --to-schema-datamodel and --exit-code. Every URL operand must be a scratch database of `baseUrl`; every path must be absolute and,
 * when `workdir` is given, inside it. Anything else (`db push`, `migrate reset`, `migrate dev`, unknown flags, repeats) is refused.
 */
function checkPrismaArgs(args, { baseUrl, workdir } = {}) {
  if (!Array.isArray(args) || args.length < 3 || args.length > 12 || !args.every((arg) => typeof arg === "string" && arg.length > 0 && arg.length <= 2100 && !/[\u0000-\u001f\u007f]/.test(arg))) return { ok: false, code: "prisma_args_malformed" };
  if (!parseStrictTarget(baseUrl).ok) return { ok: false, code: "base_target_invalid" };
  const [command, subcommand, ...rest] = args;
  if (command !== "migrate" || !Object.prototype.hasOwnProperty.call(OPERATIONS, subcommand)) return { ok: false, code: "prisma_command_not_allowed" };
  const operation = OPERATIONS[subcommand];

  const seen = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const kind = Object.prototype.hasOwnProperty.call(operation.flags, flag) ? operation.flags[flag] : undefined;
    if (kind === undefined) return { ok: false, code: "prisma_flag_not_allowed" };
    if (seen.has(flag)) return { ok: false, code: "prisma_flag_repeated" };
    if (kind === "none") { seen.set(flag, true); continue; }
    const value = rest[index + 1];
    index += 1;
    if (value === undefined) return { ok: false, code: "prisma_value_missing" };
    if (kind === "path") {
      if (!isPlainPath(value) || (workdir !== undefined && !value.startsWith(`${workdir}/`))) return { ok: false, code: "prisma_path_not_allowed" };
    } else if (kind === "migration") {
      if (!MIGRATION_NAME.test(value)) return { ok: false, code: "prisma_value_invalid" };
    } else if (kind === "url") {
      if (!checkScratchTarget(baseUrl, value).ok) return { ok: false, code: "prisma_url_not_scratch" };
    }
    seen.set(flag, value);
  }
  for (const flag of operation.required) if (!seen.has(flag)) return { ok: false, code: "prisma_flag_missing" };
  if (subcommand === "diff") {
    const fromMigrations = seen.has("--from-migrations");
    const fromUrl = seen.has("--from-url");
    if (fromMigrations === fromUrl) return { ok: false, code: "prisma_flag_missing" };
    if (fromMigrations && !seen.has("--shadow-database-url")) return { ok: false, code: "prisma_flag_missing" };
    if (fromUrl && seen.has("--shadow-database-url")) return { ok: false, code: "prisma_flag_not_allowed" };
  }
  return { ok: true };
}

module.exports = { OPT_IN_NAME, OPT_IN_VALUE, expectedNodeOptions, checkChildEnvironment, checkPrismaArgs };
