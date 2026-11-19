/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS fixture, run as a plain node script */
// Run ONLY by childIsolation.test.ts, in a child process that loads child-guard.cjs through NODE_OPTIONS (as the real Prisma CLI would).
// It stands in for the Prisma CLI: it reports what the guard allowed and does nothing else. No database, no Prisma, no real network.
const net = require("node:net");
const dns = require("node:dns");
const out = {
  key: globalThis.__RUNLAYER_CHILD_ISOLATION__ ? globalThis.__RUNLAYER_CHILD_ISOLATION__.key : null,
  databasePort: process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).port : null,
  mainGuardLoaded: Boolean(globalThis.__RUNLAYER_TEST_ISOLATION__),
};
const blocked = (fn) => { try { fn(); return false; } catch (error) { return /child isolation/.test(String(error && error.message)); } };
out.externalBlocked = blocked(() => net.connect({ host: "192.0.2.1", port: 9 }).on("error", () => {}));
out.hostnameBlocked = blocked(() => net.connect({ host: "localhost", port: 9 }).on("error", () => {}));
out.dnsBlocked = blocked(() => dns.lookup("example.invalid", () => {}));
out.fetchBlocked = blocked(() => { fetch("http://127.0.0.1:9/").catch(() => {}); });
out.loopbackAllowed = !blocked(() => net.connect({ host: "127.0.0.1", port: 1 }).on("error", () => {}));
console.log("REPORT " + JSON.stringify(out));
