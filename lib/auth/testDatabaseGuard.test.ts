import assert from "node:assert/strict";
import test from "node:test";
import { checkTestDatabase } from "./testDatabaseGuard";

const OK_URL = "postgresql://tester:pw-should-never-appear@localhost:5432/runlayer_session_test";
const enabled = { RUNLAYER_ALLOW_DB_TESTS: "1", RUNLAYER_TEST_DATABASE_URL: OK_URL };

test("database tests are disabled unless explicitly enabled", () => {
    assert.equal(checkTestDatabase({}).ok, false);
    assert.equal(checkTestDatabase({ RUNLAYER_TEST_DATABASE_URL: OK_URL }).ok, false);
    assert.equal(checkTestDatabase({ ...enabled, RUNLAYER_ALLOW_DB_TESTS: "true" }).ok, false);
    assert.equal(checkTestDatabase({ ...enabled, RUNLAYER_ALLOW_DB_TESTS: "0" }).ok, false);
});

test("a dedicated local test database is accepted", () => {
    assert.deepEqual(checkTestDatabase(enabled), { ok: true, url: OK_URL });

    for (const host of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) {
        assert.equal(checkTestDatabase({ ...enabled, RUNLAYER_TEST_DATABASE_URL: `postgres://u:p@${host}:5433/my_test_db` }).ok, true, host);
    }
});

test("a missing, unparsable or non-PostgreSQL URL is rejected", () => {
    for (const RUNLAYER_TEST_DATABASE_URL of [undefined, "", "   ", "not a url", "mysql://u:p@localhost/test_db", "http://localhost/test_db"]) {
        assert.equal(checkTestDatabase({ RUNLAYER_ALLOW_DB_TESTS: "1", RUNLAYER_TEST_DATABASE_URL }).ok, false);
    }
});

test("non-local hosts are rejected", () => {
    for (const host of ["db.example.com", "10.0.0.5", "0.0.0.0", "localhost.evil.example", "evil.example#@localhost", "prod-db.internal"]) {
        const result = checkTestDatabase({ ...enabled, RUNLAYER_TEST_DATABASE_URL: `postgresql://u:p@${host}:5432/app_test` });
        assert.equal(result.ok, false, host);
    }
});

test("a database whose name does not contain 'test' is rejected", () => {
    for (const name of ["runlayer", "postgres", "production", "app"]) {
        assert.equal(checkTestDatabase({ ...enabled, RUNLAYER_TEST_DATABASE_URL: `postgresql://u:p@localhost:5432/${name}` }).ok, false, name);
    }
});

test("the test database must not be the application's DATABASE_URL target", () => {
    const same = { ...enabled, DATABASE_URL: "postgresql://other:other@LOCALHOST:5432/runlayer_session_test" };
    assert.equal(checkTestDatabase(same).ok, false);

    const defaultPort = { RUNLAYER_ALLOW_DB_TESTS: "1", RUNLAYER_TEST_DATABASE_URL: "postgresql://u:p@localhost/x_test", DATABASE_URL: "postgresql://u:p@localhost:5432/x_test" };
    assert.equal(checkTestDatabase(defaultPort).ok, false, "the default port is normalized");

    assert.equal(checkTestDatabase({ ...enabled, DATABASE_URL: "postgresql://u:p@localhost:5432/runlayer" }).ok, true, "a different database is fine");
    assert.equal(checkTestDatabase({ ...enabled, DATABASE_URL: "not a url" }).ok, true);
});

test("rejection reasons never contain the URL or its credentials", () => {
    const attempts = [
        { ...enabled, RUNLAYER_TEST_DATABASE_URL: "postgresql://admin:super-secret-pw@prod.example.com:5432/app" },
        { ...enabled, RUNLAYER_TEST_DATABASE_URL: "postgresql://admin:super-secret-pw@localhost:5432/app" },
        { ...enabled, DATABASE_URL: OK_URL },
    ];

    for (const env of attempts) {
        const result = checkTestDatabase(env);
        assert.equal(result.ok, false);
        const reason = result.ok ? "" : result.reason;
        assert.ok(!reason.includes("super-secret-pw") && !reason.includes("pw-should-never-appear") && !reason.includes("prod.example.com"));
    }
});
