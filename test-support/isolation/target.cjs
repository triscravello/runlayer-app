"use strict";
// The single, strict policy for a DISPOSABLE integration-test database target. Pure: no I/O, no connection, no process.env access
// (callers pass what they read). Self-contained on purpose: guard.cjs requires it as a preload and a regression test copies it alone.
//
// It mirrors, rule for rule, the disposable-migration wrapper (lib/testdb/disposableTarget.ts: parseDisposableTarget, which builds on
// lib/deploy/databaseTarget.ts parseDatabaseTarget). test-support/isolation/targetAgreement.test.ts runs both over one table of URLs
// and fails if they ever disagree, so this file cannot drift looser. Where the wrapper's query-option policy is wider than the
// disposable one, the NARROWER one is used (schema=public and connect_timeout only); nothing here is more permissive than the wrapper.
//
// Every result carries a short CODE, never a URL, a credential or a path from the caller's input.

const PROTECTED_PORTS = [5432, 6543];
const MIN_PORT = 1024;
const MAX_URL_LENGTH = 2048;
// `test` must be a whole word after the `runlayer_` prefix: runlayer_g2b_test, runlayer_test_14.
const DISPOSABLE_DATABASE_NAME = /^runlayer_(?:[a-z0-9]+_)*test(?:_[a-z0-9]+)*$/;
const GENERIC_DATABASE_NAME = /^[A-Za-z0-9_.$-]{1,63}$/;
const SCHEMA_NAME = /^[A-Za-z0-9_]{1,63}$/;
const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f]/;
const LOOPBACK_V4 = /^127\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;
const HOSTNAME = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const IPV6_HOST = /^\[[0-9a-f:.]+\]$/;
const PARSER_OPTIONS = new Set(["sslmode", "schema", "connect_timeout", "connection_limit", "pool_timeout", "sslaccept", "application_name"]);
const MAX_IDENTIFIER_LENGTH = 63; // PostgreSQL silently truncates longer identifiers, which would make a tracked name differ from the real one

/** Scratch databases a suite may create next to the base database: `<base>_<kind>_<label>_<8 hex>`. */
const SCRATCH_KINDS = Object.freeze(["br", "c2"]);

const fail = (code) => ({ ok: false, code });

/**
 * Parses and restricts a disposable target. Returns { ok: true, target: { host, port, database, key, url } } or { ok: false, code }.
 * Accepts only a literal loopback IP (127.x.x.x in canonical form, or [::1]; never `localhost`, `127.1`, decimal or hex forms), an
 * EXPLICIT port that is at least 1024 and neither 5432 nor 6543, a database name matching the disposable convention, and no query
 * options other than `schema=public` and `connect_timeout=<1-2 digits>`.
 */
function parseStrictTarget(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return fail("target_missing");
  const url = raw.trim();
  if (url.length > MAX_URL_LENGTH || CONTROL_OR_SPACE.test(url)) return fail("target_malformed");

  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  if (!scheme) return fail("target_malformed");
  if (!["postgresql", "postgres"].includes(scheme[1].toLowerCase())) return fail("target_unsupported");

  // The authority is read from the RAW text: a URL parser normalizes 127.1 and 0x7f.1 and defaults a missing port.
  const afterScheme = url.slice(scheme[0].length);
  const authority = afterScheme.split(/[/?#]/, 1)[0];
  if ((authority.match(/@/g) || []).length > 1) return fail("target_ambiguous");
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostPort.includes(",")) return fail("target_ambiguous");
  if (hostPort.includes("*") || hostPort.includes("%")) return fail("target_malformed");

  let parsed;
  try { parsed = new URL(url); } catch { return fail("target_malformed"); }
  if (parsed.hash) return fail("target_malformed");

  const host = parsed.hostname.toLowerCase();
  if (!host || !(HOSTNAME.test(host) || IPV6_HOST.test(host))) return fail("target_malformed");

  let port = 5432;
  if (parsed.port !== "") {
    if (!/^\d{1,5}$/.test(parsed.port)) return fail("target_malformed");
    port = Number(parsed.port);
    if (port < 1 || port > 65535) return fail("target_malformed");
  }

  const segments = parsed.pathname.split("/");
  if (segments.length !== 2 || segments[0] !== "" || segments[1] === "") return fail("target_malformed");
  let database;
  try { database = decodeURIComponent(segments[1]); } catch { return fail("target_malformed"); }
  if (!GENERIC_DATABASE_NAME.test(database)) return fail("target_malformed");

  const seen = new Set();
  for (const [name, value] of parsed.searchParams) {
    const option = name.toLowerCase();
    if (option === "pgbouncer") return fail("target_pooler");
    if (!PARSER_OPTIONS.has(option)) return fail("target_unsafe_option");
    if (seen.has(option)) return fail("target_ambiguous");
    seen.add(option);
    if (option === "schema" && !SCHEMA_NAME.test(value)) return fail("target_malformed");
  }
  if (port === 6543) return fail("target_pooler");

  // --- the disposable restrictions -------------------------------------------------------------------------------------------------
  const ipv6 = /^\[::1\](?::(\d{1,5}))?$/.exec(hostPort);
  const ipv4 = /^([^:]+)(?::(\d{1,5}))?$/.exec(hostPort);
  let rawHost;
  let rawPort;
  if (ipv6) {
    rawHost = "[::1]";
    rawPort = ipv6[1];
  } else if (ipv4 && ipv4[1] && LOOPBACK_V4.test(ipv4[1]) && ipv4[1].split(".").every((octet) => Number(octet) <= 255)) {
    rawHost = ipv4[1];
    rawPort = ipv4[2];
  } else {
    return fail("host_not_loopback_literal");
  }
  if (host !== rawHost) return fail("host_not_loopback_literal");
  if (rawPort === undefined) return fail("port_missing");
  if (PROTECTED_PORTS.includes(port)) return fail("protected_port");
  if (port < MIN_PORT) return fail("port_out_of_range");
  if (!DISPOSABLE_DATABASE_NAME.test(database)) return fail("database_name_not_disposable");

  for (const [name, value] of new URL(url).searchParams) {
    const option = name.toLowerCase();
    if (option !== "schema" && option !== "connect_timeout") return fail("query_option_not_allowed");
    if (option === "schema" && value !== "public") return fail("query_option_not_allowed");
    if (option === "connect_timeout" && !/^\d{1,2}$/.test(value)) return fail("query_option_not_allowed");
  }
  return { ok: true, target: { host, port, database, key: `${host}:${port}/${database}`, url } };
}

// --- scratch databases ----------------------------------------------------------------------------------------------------------------

const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The exact name of a scratch database, or { ok: false, code }. Never longer than PostgreSQL's 63-character identifier limit. */
function scratchDatabaseName(baseDatabase, kind, label, suffix) {
  if (typeof baseDatabase !== "string" || !DISPOSABLE_DATABASE_NAME.test(baseDatabase)) return fail("scratch_base_invalid");
  if (!SCRATCH_KINDS.includes(kind)) return fail("scratch_kind_invalid");
  if (typeof label !== "string" || !/^[a-z0-9]{1,12}$/.test(label)) return fail("scratch_label_invalid");
  if (typeof suffix !== "string" || !/^[0-9a-f]{8}$/.test(suffix)) return fail("scratch_suffix_invalid");
  const name = `${baseDatabase}_${kind}_${label}_${suffix}`;
  if (name.length > MAX_IDENTIFIER_LENGTH) return fail("scratch_name_too_long");
  return { ok: true, name };
}

/** True only for `<base>_<kind>_<label>_<8 hex>` with a known kind. The base database itself is never a scratch name. */
function isScratchDatabaseName(baseDatabase, name, suffix) {
  if (typeof baseDatabase !== "string" || !DISPOSABLE_DATABASE_NAME.test(baseDatabase) || typeof name !== "string" || name === baseDatabase) return false;
  if (name.length > MAX_IDENTIFIER_LENGTH) return false;
  const tail = suffix === undefined ? "[0-9a-f]{8}" : escapeForRegExp(suffix);
  return new RegExp(`^${escapeForRegExp(baseDatabase)}_(?:${SCRATCH_KINDS.join("|")})_[a-z0-9]{1,12}_${tail}$`).test(name);
}

/**
 * A scratch URL must be a valid strict target of its own, on EXACTLY the base's host and port, with the base's credentials and options,
 * and a database name derived from the base's. Returns { ok: true, base, scratch } or { ok: false, code }.
 */
function checkScratchTarget(baseUrl, scratchUrl) {
  const base = parseStrictTarget(baseUrl);
  if (!base.ok) return fail("base_target_invalid");
  const scratch = parseStrictTarget(scratchUrl);
  if (!scratch.ok) return fail("scratch_target_invalid");
  if (scratch.target.host !== base.target.host || scratch.target.port !== base.target.port) return fail("scratch_host_port_mismatch");
  if (!isScratchDatabaseName(base.target.database, scratch.target.database)) return fail("scratch_name_not_derived");
  const a = new URL(base.target.url);
  const b = new URL(scratch.target.url);
  if (a.username !== b.username || a.password !== b.password || a.search !== b.search) return fail("scratch_credentials_mismatch");
  return { ok: true, base: base.target, scratch: scratch.target };
}

// --- the runner's checks ---------------------------------------------------------------------------------------------------------------

/** An absolute, canonical path: no `.`/`..`, doubled or trailing separators, whitespace or control characters; not the root. */
function checkExpectedDataDirectory(value) {
  if (typeof value !== "string" || value === "") return fail("data_dir_missing");
  if (CONTROL_OR_SPACE.test(value)) return fail("data_dir_ambiguous");
  if (!value.startsWith("/")) return fail("data_dir_not_absolute");
  if (value === "/" || value.endsWith("/") || value.includes("//") || value.split("/").some((part) => part === "." || part === "..")) return fail("data_dir_ambiguous");
  return { ok: true, dataDirectory: value };
}

/** Integration runs refuse any ambient NODE_OPTIONS that would load other code before the guard. */
function checkAmbientNodeOptions(value) {
  if (value === undefined || value === "") return { ok: true };
  if (typeof value !== "string" || CONTROL_OR_SPACE.test(value.replace(/ /g, ""))) return fail("node_options_malformed");
  if (/(^|\s)(--require|-r|--import|--loader|--experimental-loader)(?=[\s=]|$)/.test(value)) return fail("node_options_preload_present");
  return { ok: true };
}

/**
 * The runner-to-wrapper identity agreement: RUNLAYER_DISPOSABLE_URL (the wrapper's validated target) and RUNLAYER_TEST_DATABASE_URL (the
 * suites' target) must both pass the strict policy and name the same host, port and database. Credentials are not compared or reported.
 */
function checkRunnerAgreement(env) {
  const wrapper = parseStrictTarget(env.RUNLAYER_DISPOSABLE_URL);
  if (!wrapper.ok) return fail(wrapper.code === "target_missing" ? "wrapper_target_missing" : "wrapper_target_invalid");
  const tests = parseStrictTarget(env.RUNLAYER_TEST_DATABASE_URL);
  if (!tests.ok) return fail(tests.code === "target_missing" ? "test_target_missing" : "test_target_invalid");
  if (wrapper.target.key !== tests.target.key) return fail("wrapper_test_target_mismatch");
  const directory = checkExpectedDataDirectory(env.RUNLAYER_DISPOSABLE_DATA_DIR);
  if (!directory.ok) return fail(`wrapper_${directory.code}`);
  return { ok: true, key: tests.target.key, dataDirectory: directory.dataDirectory };
}

const REASONS = {
  target_missing: "RUNLAYER_TEST_DATABASE_URL is not set",
  target_malformed: "RUNLAYER_TEST_DATABASE_URL is not a valid PostgreSQL URL",
  target_unsupported: "RUNLAYER_TEST_DATABASE_URL must be a PostgreSQL URL",
  target_ambiguous: "RUNLAYER_TEST_DATABASE_URL is ambiguous",
  target_pooler: "RUNLAYER_TEST_DATABASE_URL must not name a pooler (port 6543 or pgbouncer)",
  target_unsafe_option: "RUNLAYER_TEST_DATABASE_URL must not carry host-override or connection options",
  host_not_loopback_literal: "RUNLAYER_TEST_DATABASE_URL must name a literal loopback IP (127.x.x.x or [::1]), never localhost or a host name",
  port_missing: "RUNLAYER_TEST_DATABASE_URL must name an explicit port (a URL without a port means 5432)",
  protected_port: "RUNLAYER_TEST_DATABASE_URL must not use port 5432 or 6543 (a dedicated throwaway server on its own port is required)",
  port_out_of_range: "RUNLAYER_TEST_DATABASE_URL must use a port of 1024 or higher",
  database_name_not_disposable: "the test database name must match runlayer_..._test_... (test as a whole word)",
  query_option_not_allowed: "RUNLAYER_TEST_DATABASE_URL may carry only schema=public and connect_timeout",
};

/** The launcher's and the preload's check of RUNLAYER_ALLOW_DB_TESTS + RUNLAYER_TEST_DATABASE_URL. Reasons never contain the URL. */
function checkIntegrationTarget(env) {
  if (env.RUNLAYER_ALLOW_DB_TESTS !== "1") return { ok: false, code: "not_enabled", reason: "database tests are not enabled (set RUNLAYER_ALLOW_DB_TESTS=1)" };
  const parsed = parseStrictTarget(env.RUNLAYER_TEST_DATABASE_URL);
  if (!parsed.ok) return { ok: false, code: parsed.code, reason: REASONS[parsed.code] || "RUNLAYER_TEST_DATABASE_URL was rejected" };

  const appUrl = (env.DATABASE_URL || "").trim();
  if (appUrl) {
    try {
      const app = new URL(appUrl);
      const appKey = `${app.hostname.toLowerCase()}:${app.port || "5432"}/${decodeURIComponent(app.pathname.replace(/^\//, ""))}`;
      if (appKey === parsed.target.key) return { ok: false, code: "same_as_database_url", reason: "the test database must differ from DATABASE_URL" };
    } catch { /* an unparsable DATABASE_URL cannot be the same target */ }
  }
  return { ok: true, url: parsed.target.url, target: parsed.target };
}

module.exports = {
  PROTECTED_PORTS, MIN_PORT, SCRATCH_KINDS, DISPOSABLE_DATABASE_NAME,
  parseStrictTarget, scratchDatabaseName, isScratchDatabaseName, checkScratchTarget,
  checkExpectedDataDirectory, checkAmbientNodeOptions, checkRunnerAgreement, checkIntegrationTarget,
};
