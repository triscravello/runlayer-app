import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { DISPOSABLE_DATABASE_NAME as WRAPPER_NAME, MIN_DISPOSABLE_PORT, PROTECTED_PORTS as WRAPPER_PROTECTED, parseDisposableTarget } from "../../lib/testdb/disposableTarget";

// The shared integration validator (target.cjs) must accept and refuse EXACTLY what the disposable-migration wrapper does, so the runner,
// the preload, the suites and the wrapper can never disagree about what a disposable target is. Offline; no database, no network.
const shared = createRequire(import.meta.url)("./target.cjs") as typeof import("./target.cjs");

const wrapperAccepts = (url: string) => { try { return parseDisposableTarget(url).key; } catch { return null; } };
const sharedAccepts = (url: string) => { const parsed = shared.parseStrictTarget(url); return parsed.ok ? parsed.target.key : null; };

const HOSTS = ["127.0.0.1", "127.0.0.2", "127.255.255.254", "[::1]", "localhost", "LOCALHOST", "127.1", "127.0.1", "127.00.0.1", "127.0.0.01", "127.0.0.256", "2130706433", "0x7f.0.0.1", "0.0.0.0", "10.0.0.5", "192.0.2.1", "[::2]", "[::ffff:127.0.0.1]", "db.example.invalid", "127.0.0.1.example.invalid", "0177.0.0.1", "[0:0:0:0:0:0:0:1]"];
const PORTS = ["", ":5432", ":6543", ":54329", ":1024", ":1023", ":80", ":65535", ":65536", ":0", ":05432", ":054329", ":abc", ":5432x"];
const NAMES = ["runlayer_test", "runlayer_g2b_test", "runlayer_test_14", "runlayer_g2_test_br_clean_0123abcd", "runlayer_Test", "runlayer_testing", "runlayer_x", "app_test", "postgres", "test", "runlayer__test", "runlayer_a b_test", `runlayer_${"a".repeat(60)}_test`, "runlayer_test%20x", "runlayer_ünï_test"];
const QUERIES = ["", "?schema=public", "?schema=other", "?connect_timeout=5", "?connect_timeout=500", "?connect_timeout=x", "?schema=public&connect_timeout=5", "?sslmode=disable", "?host=db.example.invalid", "?hostaddr=192.0.2.1", "?pgbouncer=true", "?schema=public&schema=public", "?application_name=x", "?SCHEMA=public", "?connection_limit=1", "?service=x"];

test("the shared integration validator agrees with the disposable wrapper on every combination of host, port, database name and query option", () => {
    let accepted = 0;
    let combinations = 0;
    for (const host of HOSTS) {
        for (const port of PORTS) {
            for (const name of NAMES) {
                const url = `postgresql://u:pw@${host}${port}/${name}`;
                combinations += 1;
                assert.equal(sharedAccepts(url), wrapperAccepts(url), `disagreement on a combination (host ${host}, port ${port || "(none)"}, name ${name.slice(0, 24)})`);
                if (sharedAccepts(url) !== null) accepted += 1;
            }
        }
    }
    for (const query of QUERIES) for (const base of ["postgresql://u:pw@127.0.0.1:54329/runlayer_test", "postgres://u@[::1]:54329/runlayer_test_1"]) {
        combinations += 1;
        assert.equal(sharedAccepts(`${base}${query}`), wrapperAccepts(`${base}${query}`), `disagreement on query ${query}`);
    }
    assert.ok(combinations > 4000 && accepted > 30, `the table exercises both outcomes (${accepted} accepted of ${combinations})`);
});

test("the shared validator agrees with the wrapper on structural oddities in the URL itself", () => {
    for (const url of [
        "", "   ", "not a url", "mysql://u:p@127.0.0.1:54329/runlayer_test", "http://127.0.0.1:54329/runlayer_test", "postgresql://127.0.0.1:54329/runlayer_test", "POSTGRESQL://u:p@127.0.0.1:54329/runlayer_test", "postgres://u:p@127.0.0.1:54329/runlayer_test",
        "postgresql://u:p@127.0.0.1:54329/runlayer_test/extra", "postgresql://u:p@127.0.0.1:54329/", "postgresql://u:p@127.0.0.1:54329", "postgresql://u:p@127.0.0.1:54329/runlayer_test#frag", "postgresql://u:p@evil.example#@127.0.0.1:54329/runlayer_test",
        "postgresql://a@b@127.0.0.1:54329/runlayer_test", "postgresql://u:p@127.0.0.1:54329,10.0.0.1:54329/runlayer_test", "postgresql://u:p@127.0.0.1:54329/runlayer_test ", " postgresql://u:p@127.0.0.1:54329/runlayer_test", "postgresql://u:p@127.0.0.1:54329/runlayer\ntest",
        "postgresql://u:p%40x@127.0.0.1:54329/runlayer_test", "postgresql://u:p@127.0.0.1:54329/runlayer%5Ftest", `postgresql://u:p@127.0.0.1:54329/${"a".repeat(2100)}`, "postgresql://u:p@[::1]:54329/runlayer_test", "postgresql://u:p@[::1]/runlayer_test", "postgresql://u:p@%31%32%37.0.0.1:54329/runlayer_test",
    ]) {
        assert.equal(sharedAccepts(url), wrapperAccepts(url), url.slice(0, 40).replace(/:[^:@/]*@/, ":<>@"));
    }
});

test("the shared constants cannot drift from the wrapper's", () => {
    assert.equal(shared.DISPOSABLE_DATABASE_NAME.source, WRAPPER_NAME.source);
    assert.deepEqual([...shared.PROTECTED_PORTS], [...WRAPPER_PROTECTED]);
    assert.equal(shared.MIN_PORT, MIN_DISPOSABLE_PORT);
});

test("rejections carry a code and never echo the URL, a credential or a host name", () => {
    for (const url of ["postgresql://admin:super-secret-pw@prod.example.com:5432/app", "postgresql://admin:super-secret-pw@127.0.0.1:5432/runlayer_x_test", "postgresql://admin:super-secret-pw@localhost:54329/runlayer_x_test"]) {
        const result = shared.parseStrictTarget(url);
        assert.equal(result.ok, false);
        assert.match(result.ok ? "" : result.code, /^[a-z_]+$/);
        const verdict = shared.checkIntegrationTarget({ RUNLAYER_ALLOW_DB_TESTS: "1", RUNLAYER_TEST_DATABASE_URL: url });
        assert.equal(verdict.ok, false);
        assert.doesNotMatch(JSON.stringify(verdict), /super-secret-pw|prod\.example\.com|admin:|postgresql:\/\//);
    }
});
