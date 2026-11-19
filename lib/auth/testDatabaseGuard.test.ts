import assert from "node:assert/strict";
import test from "node:test";
import { checkTestDatabase, resolveTestDatabase } from "./testDatabaseGuard";

const OK_URL = "postgresql://tester:pw-should-never-appear@127.0.0.1:54329/runlayer_session_test";
const enabled = { RUNLAYER_ALLOW_DB_TESTS: "1", RUNLAYER_TEST_DATABASE_URL: OK_URL };
const withUrl = (url: string | undefined) => ({ ...enabled, RUNLAYER_TEST_DATABASE_URL: url });

test("database tests are disabled unless explicitly enabled", () => {
    assert.equal(checkTestDatabase({}).ok, false);
    assert.equal(checkTestDatabase({ RUNLAYER_TEST_DATABASE_URL: OK_URL }).ok, false);
    assert.equal(checkTestDatabase({ ...enabled, RUNLAYER_ALLOW_DB_TESTS: "true" }).ok, false);
    assert.equal(checkTestDatabase({ ...enabled, RUNLAYER_ALLOW_DB_TESTS: "0" }).ok, false);
});

test("a disposable loopback test database on its own port is accepted", () => {
    assert.deepEqual(checkTestDatabase(enabled), { ok: true, url: OK_URL });
    for (const host of ["127.0.0.1", "127.0.0.2", "[::1]"]) {
        assert.equal(checkTestDatabase(withUrl(`postgres://u:p@${host}:5433/runlayer_my_test_db`)).ok, true, host);
    }
});

test("direct execution cannot reach the real local server, a pooler, localhost, a host name or an ambiguous port", () => {
    for (const url of [
        "postgresql://u:p@127.0.0.1:5432/runlayer_x_test", "postgresql://u:p@127.0.0.1:6543/runlayer_x_test", "postgresql://u:p@127.0.0.1/runlayer_x_test",
        "postgresql://u:p@localhost:54329/runlayer_x_test", "postgresql://u:p@LOCALHOST:54329/runlayer_x_test", "postgresql://u:p@127.1:54329/runlayer_x_test",
        "postgresql://u:p@2130706433:54329/runlayer_x_test", "postgresql://u:p@0x7f.1:54329/runlayer_x_test", "postgresql://u:p@db.example.invalid:54329/runlayer_x_test",
        "postgresql://u:p@10.0.0.5:54329/runlayer_x_test", "postgresql://u:p@0.0.0.0:54329/runlayer_x_test", "postgresql://u:p@evil.example#@127.0.0.1:54329/runlayer_x_test",
        "postgresql://u:p@127.0.0.1:1023/runlayer_x_test", "postgresql://u:p@127.0.0.1:54329/runlayer_x_test?host=db.example.invalid",
    ]) {
        assert.equal(checkTestDatabase(withUrl(url)).ok, false, url.replace(/:p@/, ":<>@"));
    }
});

test("a missing, unparsable or non-PostgreSQL URL is rejected", () => {
    for (const url of [undefined, "", "   ", "not a url", "mysql://u:p@127.0.0.1:3306/runlayer_x_test", "http://127.0.0.1/runlayer_x_test"]) {
        assert.equal(checkTestDatabase(withUrl(url)).ok, false);
    }
});

test("only the disposable database-name convention is accepted", () => {
    for (const name of ["runlayer", "postgres", "production", "app", "app_test", "runlayer_testing", "runlayer_Test", "test", "runlayer_x"]) {
        assert.equal(checkTestDatabase(withUrl(`postgresql://u:p@127.0.0.1:54329/${name}`)).ok, false, name);
    }
    for (const name of ["runlayer_test", "runlayer_g2b_test", "runlayer_test_14"]) {
        assert.equal(checkTestDatabase(withUrl(`postgresql://u:p@127.0.0.1:54329/${name}`)).ok, true, name);
    }
});

test("the test database must not be the application's DATABASE_URL target", () => {
    assert.equal(checkTestDatabase({ ...enabled, DATABASE_URL: "postgresql://other:other@127.0.0.1:54329/runlayer_session_test" }).ok, false);
    assert.equal(checkTestDatabase({ ...enabled, DATABASE_URL: "postgresql://u:p@127.0.0.1:54329/runlayer" }).ok, true, "a different database is fine");
    assert.equal(checkTestDatabase({ ...enabled, DATABASE_URL: "not a url" }).ok, true);
});

test("rejection reasons never contain the URL or its credentials", () => {
    const attempts = [
        withUrl("postgresql://admin:super-secret-pw@prod.example.com:5432/app"),
        withUrl("postgresql://admin:super-secret-pw@localhost:5432/app"),
        withUrl("postgresql://admin:super-secret-pw@127.0.0.1:5432/runlayer_x_test"),
        { ...enabled, DATABASE_URL: OK_URL },
    ];
    for (const env of attempts) {
        const result = checkTestDatabase(env);
        assert.equal(result.ok, false);
        const reason = result.ok ? "" : result.reason;
        assert.ok(!reason.includes("super-secret-pw") && !reason.includes("pw-should-never-appear") && !reason.includes("prod.example.com"));
    }
});

test("resolveTestDatabase: not opted in is a safe skip; opted in with an invalid target FAILS LOUDLY before any connection", () => {
    assert.equal(resolveTestDatabase({}).ok, false, "not enabled: skip");
    assert.equal(resolveTestDatabase({ RUNLAYER_TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/runlayer_x_test" }).ok, false, "not enabled: skip even with a bad target");
    assert.deepEqual(resolveTestDatabase(enabled), { ok: true, url: OK_URL });
    for (const url of ["postgresql://u:super-secret-pw@127.0.0.1:5432/runlayer_x_test", "postgresql://u:super-secret-pw@localhost:54329/runlayer_x_test", "", undefined]) {
        assert.throws(() => resolveTestDatabase(withUrl(url)), (error: Error) => /integration tests refused/.test(error.message) && !error.message.includes("super-secret-pw"));
    }
});
