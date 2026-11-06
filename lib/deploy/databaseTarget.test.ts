import assert from "node:assert/strict";
import test from "node:test";
import { TargetError, assertTargetAllowed, assertTargetConfirmed, parseDatabaseTarget, parseTargetAllowlist, withConnectTimeout, type TargetErrorCode } from "./databaseTarget";
import { SENTINEL_PASSWORD, TARGET, TARGET_URL } from "./testFixtures";

function codeOf(fn: () => unknown): TargetErrorCode {
    try {
        fn();
    } catch (error) {
        assert.ok(error instanceof TargetError, "expected a TargetError");
        // Every message is fixed text: no URL, host, user or password.
        assert.doesNotMatch(error.message, /s3cr3t|example\.test|\/\/\S*@/i);
        return error.code;
    }
    assert.fail("expected a TargetError");
}

test("a well-formed target yields host:port/database and keeps the URL private", () => {
    const target = parseDatabaseTarget("postgresql://user:pw@DB.Example.TEST:5433/AppDb?sslmode=require&schema=public");
    assert.equal(target.key, "db.example.test:5433/AppDb");
    assert.equal(target.host, "db.example.test");
    assert.equal(target.port, 5433);
    assert.equal(target.database, "AppDb");
    assert.doesNotMatch(target.key, /pw|user/);
    assert.equal(parseDatabaseTarget("postgres://u:p@h.test/db").key, "h.test:5432/db");
});

test("surrounding whitespace is trimmed, embedded whitespace is not", () => {
    assert.equal(parseDatabaseTarget("  postgresql://u:p@host.test/db\n").key, "host.test:5432/db");
});

test("missing configuration is refused", () => {
    for (const value of [undefined, null, "", "   "]) assert.equal(codeOf(() => parseDatabaseTarget(value)), "missing");
});

test("malformed targets are refused", () => {
    const malformed = [
        "not a url",
        "postgresql://",
        "postgresql:///db",
        "postgresql://u:p@host.test",
        "postgresql://u:p@host.test/",
        "postgresql://u:p@host.test/a/b",
        "postgresql://u:p@host.test:70000/db",
        "postgresql://u:p@host.test:0/db",
        "postgresql://u:p@host.test:12ab/db",
        "postgresql://u:p@*.example.test/db",
        "postgresql://u:p@ho%73t.test/db",
        "postgresql://u:p@host.test/db#fragment",
        "postgresql://u:p@host.test/da tabase",
        "postgresql://u:p@host.test/d\nb",
        "postgresql://u:p@host.test/bad;name",
        `postgresql://u:p@host.test/${"x".repeat(64)}`,
        `postgresql://u:p@host.test/db?schema=a-b`,
        `postgresql://u:p@host.test/db?${"a".repeat(3000)}`,
    ];
    for (const value of malformed) assert.equal(codeOf(() => parseDatabaseTarget(value)), "malformed", value.slice(0, 60));
});

test("other schemes are refused", () => {
    for (const value of ["mysql://u:p@h.test/db", "http://h.test/db", "file:///tmp/x"]) assert.equal(codeOf(() => parseDatabaseTarget(value)), "unsupported_protocol");
});

test("ambiguous targets are refused", () => {
    assert.equal(codeOf(() => parseDatabaseTarget("postgresql://u:p@evil.test@good.test/db")), "ambiguous");
    assert.equal(codeOf(() => parseDatabaseTarget("postgresql://u:p@a.test:5432,b.test:5432/db")), "ambiguous");
    assert.equal(codeOf(() => parseDatabaseTarget("postgresql://u:p@host.test/db?sslmode=require&sslmode=disable")), "ambiguous");
});

test("options that could redirect the connection are refused", () => {
    for (const option of ["host=other.test", "hostaddr=10.0.0.1", "port=5999", "dbname=other", "options=-c%20search_path=x", "service=x", "user=admin", "password=x"]) {
        assert.equal(codeOf(() => parseDatabaseTarget(`postgresql://u:p@host.test/db?${option}`)), "unsafe_option", option);
    }
});

test("transaction poolers are refused for migrations", () => {
    assert.equal(codeOf(() => parseDatabaseTarget("postgresql://u:p@host.test:6543/db")), "pooler");
    assert.equal(codeOf(() => parseDatabaseTarget("postgresql://u:p@host.test:5432/db?pgbouncer=true")), "pooler");
    assert.equal(codeOf(() => parseDatabaseTarget("postgresql://u:p@host.test:5432/db?PgBouncer=true")), "pooler");
});

test("an allowlist holds exact entries only", () => {
    const list = parseTargetAllowlist("DB.example.test:5432/appdb, other.test:5433/postgres\nthird.test:5432/Mixed_Case");
    assert.deepEqual([...list].sort(), ["db.example.test:5432/appdb", "other.test:5433/postgres", "third.test:5432/Mixed_Case"]);
    assert.equal(parseTargetAllowlist("[::1]:5432/db").has("[::1]:5432/db"), true);
});

test("a missing or empty allowlist is refused", () => {
    for (const value of [undefined, null, "", "  ,  \n "]) assert.equal(codeOf(() => parseTargetAllowlist(value)), "allowlist_missing");
});

test("wildcards, patterns and incomplete entries are refused", () => {
    const bad = ["*", "*.example.test:5432/db", "db.example.test:*/db", "db.example.test:5432/*", "db.example.test/db", "db.example.test:5432", "db.example.test:5432/", "postgresql://db.example.test:5432/db", "db.example.test:0/db", "db.example.test:99999/db", "db?.example.test:5432/db", "a.test:5432/db b.test"];
    for (const value of bad) assert.equal(codeOf(() => parseTargetAllowlist(`ok.test:5432/ok ${value}`)), "allowlist_invalid", value);
    assert.equal(codeOf(() => parseTargetAllowlist(Array.from({ length: 21 }, (_, i) => `h${i}.test:5432/db`).join(","))), "allowlist_invalid");
});

test("the target must match an allowlist entry exactly", () => {
    assertTargetAllowed(TARGET, parseTargetAllowlist("db.example.test:5432/appdb"));
    assertTargetAllowed(TARGET, parseTargetAllowlist("x.test:5432/x db.example.test:5432/appdb"));

    for (const entry of ["db.example.test:5432/appdb2", "db.example.test:5433/appdb", "db2.example.test:5432/appdb", "example.test:5432/appdb", "db.example.test:5432/APPDB", "b.example.test:5432/appdb"]) {
        assert.equal(codeOf(() => assertTargetAllowed(TARGET, parseTargetAllowlist(entry))), "not_allowed", entry);
    }
});

test("the operator must retype the full host:port/database", () => {
    assertTargetConfirmed(TARGET, "db.example.test:5432/appdb");
    for (const value of [undefined, null, ""]) assert.equal(codeOf(() => assertTargetConfirmed(TARGET, value)), "confirmation_missing");
    for (const value of ["appdb", "db.example.test/appdb", "db.example.test:5432/appdb ", " db.example.test:5432/appdb", "DB.EXAMPLE.TEST:5432/appdb", "db.example.test:5432/other", TARGET_URL]) {
        assert.equal(codeOf(() => assertTargetConfirmed(TARGET, value)), "confirmation_mismatch", value);
    }
});

test("a connect timeout is added only when the operator set none, and the password never appears in the key", () => {
    assert.match(withConnectTimeout(TARGET, 10), /connect_timeout=10/);
    assert.match(withConnectTimeout(parseDatabaseTarget("postgresql://u:p@h.test/db?connect_timeout=3"), 10), /connect_timeout=3/);
    assert.doesNotMatch(TARGET.key, new RegExp(SENTINEL_PASSWORD));
});
