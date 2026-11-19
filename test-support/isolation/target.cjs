"use strict";
// Verifies that an integration-test database target is explicit, local and unambiguous. Pure: no I/O, no connection.
// It repeats the rules of lib/auth/testDatabaseGuard.ts (which the integration suites still apply themselves) and is
// stricter about ambiguity. A test keeps the two in agreement. Reasons never contain the URL or its credentials.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
// libpq connection-string parameters that can silently replace the host named in the URL.
const HOST_OVERRIDE_PARAMS = ["host", "hostaddr", "service", "servicefile", "passfile"];

const targetKey = (url) => `${url.hostname.toLowerCase()}:${url.port || "5432"}/${decodeURIComponent(url.pathname.replace(/^\//, ""))}`;

function checkIntegrationTarget(env) {
  if (env.RUNLAYER_ALLOW_DB_TESTS !== "1") return { ok: false, reason: "database tests are not enabled (set RUNLAYER_ALLOW_DB_TESTS=1)" };

  const raw = (env.RUNLAYER_TEST_DATABASE_URL || "").trim();
  if (!raw) return { ok: false, reason: "RUNLAYER_TEST_DATABASE_URL is not set" };

  let url;
  try { url = new URL(raw); } catch { return { ok: false, reason: "RUNLAYER_TEST_DATABASE_URL is not a valid URL" }; }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return { ok: false, reason: "RUNLAYER_TEST_DATABASE_URL must be a PostgreSQL URL" };
  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) return { ok: false, reason: "RUNLAYER_TEST_DATABASE_URL must point at a local host" };
  for (const param of HOST_OVERRIDE_PARAMS) {
    if (url.searchParams.has(param)) return { ok: false, reason: "RUNLAYER_TEST_DATABASE_URL must not carry host-override parameters" };
  }

  // The default PostgreSQL port is where a real local server may live. An explicit, different port is required: a URL without a port means 5432.
  if (!url.port || Number(url.port) === 5432) return { ok: false, reason: "RUNLAYER_TEST_DATABASE_URL must name an explicit port other than 5432 (a dedicated throwaway server)" };

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/test/i.test(database)) return { ok: false, reason: 'the test database name must contain "test"' };

  const appUrl = (env.DATABASE_URL || "").trim();
  if (appUrl) {
    try {
      if (targetKey(new URL(appUrl)) === targetKey(url)) return { ok: false, reason: "the test database must differ from DATABASE_URL" };
    } catch { /* an unparsable DATABASE_URL cannot be the same target */ }
  }

  return { ok: true, url: raw };
}

module.exports = { checkIntegrationTarget };
