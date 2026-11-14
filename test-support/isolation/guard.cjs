"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload, loaded with `node --require` before any ES module */
// Test-isolation preload. It is loaded with `node --require` (through NODE_OPTIONS, by scripts/runTests.mjs) before any
// application module, in the test runner and in every test subprocess. It protects CONFIGURATION and NODE-LEVEL NETWORK
// ACCESS; it cannot stop native code (the Prisma query engine, psql) from opening its own sockets. See README "Testing".
//
// Never prints, logs or throws a URL, hostname or credential. Messages name variables, never values.

const Module = require("node:module");
const net = require("node:net");
const dns = require("node:dns");
const fs = require("node:fs");
const path = require("node:path");
const { checkIntegrationTarget } = require("./target.cjs");

class TestIsolationError extends Error {
  constructor(message) { super(`test isolation: ${message}`); this.name = "TestIsolationError"; }
}

const ROOT = process.env.RUNLAYER_TEST_ROOT || path.resolve(__dirname, "..", "..");
const profileName = process.env.RUNLAYER_TEST_PROFILE;
if (profileName !== undefined && profileName !== "" && profileName !== "unit" && profileName !== "integration") {
  throw new TestIsolationError("RUNLAYER_TEST_PROFILE must be 'unit' or 'integration'");
}
const PROFILE = profileName === "integration" ? "integration" : "unit";

// An unreachable loopback target: port 1 refuses connections. Prisma gives process.env precedence over `.env`.
const SENTINEL_DATABASE_URL = "postgresql://runlayer_test:runlayer_test@127.0.0.1:1/runlayer_isolated_never";

const isLoopbackHost = (host) => host === undefined || host === null || host === "" || host === "localhost" || host === "::1" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);
const hostnameOf = (value) => { try { return new URL(String(value)).hostname; } catch { return null; } };
const isLoopbackUrl = (value) => { const host = hostnameOf(value); return host !== null && isLoopbackHost(host); };

// 1. Integration profile: refuse to start at all unless the target is explicit, local and unambiguous.
if (PROFILE === "integration") {
  const check = checkIntegrationTarget(process.env);
  if (!check.ok) throw new TestIsolationError(`integration tests refused: ${check.reason}`);
}

// 2. Neutralize hosted configuration. Values are replaced by "" (defined but empty), never deleted: Prisma Client copies the
// keys of `.env` into process.env only when they are undefined, so a deleted variable would come straight back.
const NETWORK_NAME = /(DATABASE|POSTGRES|REDIS|SUPABASE|UPSTASH|MONGO|MYSQL)/i;
const EXTRA_NAMES = new Set(["WEATHER_API_KEY", "METRICS_TOKEN", "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGSSLMODE", "PGPASSFILE", "PGOPTIONS", "DIRECT_URL", "SHADOW_DATABASE_URL"]);
const OPT_IN_NAMES = new Set(["RUNLAYER_ALLOW_DB_TESTS", "RUNLAYER_TEST_DATABASE_URL", "RUNLAYER_TEST_PSQL"]);
const NON_LOCAL_SERVICE_URL = /^(postgres(ql)?|redis(s)?|mysql|mongodb(\+srv)?|amqps?|https?|wss?):\/\//i;

const neutralized = [];
for (const name of Object.keys(process.env)) {
  const value = process.env[name] || "";
  const keepForIntegration = PROFILE === "integration" && (name === "RUNLAYER_ALLOW_DB_TESTS" || name === "RUNLAYER_TEST_DATABASE_URL");
  if (keepForIntegration) continue;
  const byName = NETWORK_NAME.test(name) || EXTRA_NAMES.has(name) || name.startsWith("RUNLAYER_MIGRATE_") || name.startsWith("RUNLAYER_PREFLIGHT_") || name === "RUNLAYER_DB_ALLOWED_TARGETS" || OPT_IN_NAMES.has(name);
  const byValue = NON_LOCAL_SERVICE_URL.test(value) && !isLoopbackUrl(value);
  if (byName || byValue) { process.env[name] = ""; neutralized.push(name); }
}

// 3. Pre-define every key NAME in the repository's `.env` files (names only; values are never read into memory).
for (const file of [".env", path.join("prisma", ".env")]) {
  let text = "";
  try { text = fs.readFileSync(path.join(ROOT, file), "utf8"); } catch { continue; }
  for (const match of text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
    if (process.env[match[1]] === undefined) { process.env[match[1]] = ""; neutralized.push(match[1]); }
  }
}
process.env.DATABASE_URL = SENTINEL_DATABASE_URL;

// 4. Node-level network guard: only loopback and unix sockets. Throws synchronously; nothing is sent.
const deny = (what) => { throw new TestIsolationError(`outbound ${what} to a non-local destination is blocked`); };

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  // net.connect() hands over an already-normalized array, [options, callback]; Socket#connect() may also be called directly with
  // (options), (port, host) or (path). An unrecognized shape is denied rather than allowed.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  let options;
  if (first && typeof first === "object") options = first;
  else if (typeof first === "string" && Number.isNaN(Number(first))) options = { path: first };
  else if (typeof first === "number" || typeof first === "string") options = { port: first, host: typeof args[1] === "string" ? args[1] : undefined };
  else deny("socket connection");
  if (!options.path && !isLoopbackHost(options.host)) deny("socket connection");
  return originalConnect.apply(this, args);
};

const guardedDns = (original) => function guardedLookup(host, ...rest) {
  if (typeof host === "string" && !isLoopbackHost(host) && !net.isIP(host)) deny("DNS lookup");
  return original.call(this, host, ...rest);
};
for (const fn of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny"]) {
  if (typeof dns[fn] === "function") dns[fn] = guardedDns(dns[fn]);
  if (dns.promises && typeof dns.promises[fn] === "function") dns.promises[fn] = guardedDns(dns.promises[fn]);
}

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, ...rest) {
    const target = typeof input === "string" ? input : input && typeof input === "object" && "url" in input ? input.url : String(input);
    if (!isLoopbackUrl(target)) deny("fetch");
    return originalFetch.call(this, input, ...rest);
  };
}

// 5. PrismaClient constructor guard. Checked at construction, so a URL assigned after startup is caught as well.
const originalLoad = Module._load;
Module._load = function guardedLoad() {
  const loaded = originalLoad.apply(this, arguments);
  // Matched by shape, not by request string: an ES-module `import` reaches this hook with an absolute file path, and the Prisma
  // package is also reachable as `.prisma/client`. Whichever module first exposes a PrismaClient constructor gets the guard,
  // and modules that re-export it receive the guarded one.
  if (loaded && typeof loaded === "object" && typeof loaded.PrismaClient === "function" && !loaded.PrismaClient.__runlayerGuarded) {
    const Guarded = new Proxy(loaded.PrismaClient, {
      construct(target, args, newTarget) {
        const options = args[0] || {};
        const url = options.datasourceUrl ?? (options.datasources && options.datasources.db && options.datasources.db.url) ?? process.env.DATABASE_URL;
        if (!isLoopbackUrl(url)) throw new TestIsolationError("PrismaClient refused: the database URL is not a local address");
        return Reflect.construct(target, args, newTarget);
      },
      get(target, property, receiver) { return property === "__runlayerGuarded" ? true : Reflect.get(target, property, receiver); },
    });
    try { loaded.PrismaClient = Guarded; } catch { throw new TestIsolationError("could not install the PrismaClient guard"); }
  }
  return loaded;
};

// 6. Marker read by lib/prisma.ts (fail closed when absent under node:test) and by the regression tests.
Object.defineProperty(globalThis, "__RUNLAYER_TEST_ISOLATION__", {
  value: Object.freeze({ active: true, profile: PROFILE, neutralized: Object.freeze([...new Set(neutralized)]) }),
  enumerable: false,
});
