"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload, loaded with `node --require` before the Prisma CLI */
// Preload for a PRISMA CLI CHILD started by an integration suite through prismaChild.ts. It is NOT guard.cjs and guard.cjs is not
// loaded into this child. Unless every condition in childPolicy.cjs holds, it throws before the CLI runs a single line:
//   - RUNLAYER_CHILD_ISOLATION=prisma-cli, and NODE_OPTIONS is exactly `--require <this file>`;
//   - RUNLAYER_TEST_DATABASE_URL is a valid strict disposable target and DATABASE_URL is a scratch database derived from it
//     (same literal loopback host and port, exact scratch name, never the base itself);
//   - no other connection variable (hosted, PG*, DIRECT_URL, SHADOW_DATABASE_URL ...) is set;
//   - the command line is one of the approved `prisma migrate ...` operations, and every URL operand is a scratch database of the base.
// Node-level sockets, DNS and fetch are then limited to literal loopback addresses and unix sockets.
//
// WHAT THIS DOES NOT DO: these hooks see only Node. The Prisma schema engine and query engine are native binaries and open their own
// sockets; a macOS `sandbox-exec` network jail remains mandatory for any live run. DNS still resolves inside that jail.
// Errors name a code, never a URL, credential or path.

const net = require("node:net");
const dns = require("node:dns");
const { checkChildEnvironment, checkPrismaArgs } = require("./childPolicy.cjs");

const refuse = (code) => { throw new Error(`child isolation: ${code}`); };

const environment = checkChildEnvironment(process.env, __filename);
if (!environment.ok) refuse(environment.code);
const baseUrl = process.env.RUNLAYER_TEST_DATABASE_URL;
const operation = checkPrismaArgs(process.argv.slice(2), { baseUrl });
if (!operation.ok) refuse(operation.code);

const isLoopbackLiteral = (host) => typeof host === "string" && (host === "::1" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host));

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  let options;
  if (first && typeof first === "object") options = first;
  else if (typeof first === "string" && Number.isNaN(Number(first))) options = { path: first };
  else refuse("socket_shape_not_allowed");
  if (!options.path && !isLoopbackLiteral(options.host)) refuse("socket_not_loopback");
  return originalConnect.apply(this, args);
};

// A literal IP needs no lookup; any host NAME is refused (even `localhost`).
const guardedDns = (original) => function guardedLookup(host, ...rest) {
  if (typeof host === "string" && net.isIP(host)) return original.call(this, host, ...rest);
  return refuse("dns_not_allowed");
};
for (const fn of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny"]) {
  if (typeof dns[fn] === "function") dns[fn] = guardedDns(dns[fn]);
  if (dns.promises && typeof dns.promises[fn] === "function") dns.promises[fn] = guardedDns(dns.promises[fn]);
}
if (typeof globalThis.fetch === "function") globalThis.fetch = function guardedFetch() { return refuse("fetch_not_allowed"); };

Object.defineProperty(globalThis, "__RUNLAYER_CHILD_ISOLATION__", { value: Object.freeze({ active: true, key: environment.scratch.key }), enumerable: false });
