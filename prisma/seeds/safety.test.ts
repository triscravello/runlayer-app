import assert from "node:assert/strict";
import test from "node:test";
import {
    SeedSafetyError,
    assertSafeSeedTarget,
    evaluateSeedTarget,
    evaluateServerIdentity,
    validateSeedPassword,
    type SeedTarget,
    type ServerIdentity,
} from "./safety";

const CONFIRM = "runlayer_dev";
const base = { DATABASE_URL: `postgresql://dev:pw@localhost:5432/${CONFIRM}`, RUNLAYER_SEED_CONFIRM_DATABASE: CONFIRM };

function code(env: Record<string, string | undefined>) {
    const verdict = evaluateSeedTarget(env);
    return verdict.ok ? "ok" : verdict.code;
}

function withUrl(url: string, confirm = CONFIRM) {
    return { DATABASE_URL: url, RUNLAYER_SEED_CONFIRM_DATABASE: confirm };
}

// --- allowed targets -----------------------------------------------------------

test("dedicated local databases with a matching confirmation are accepted", () => {
    const cases: Array<[string, string, SeedTarget]> = [
        ["postgresql://u:p@localhost:5432/runlayer_dev", "runlayer_dev", { database: "runlayer_dev", transport: "tcp", port: 5432 }],
        ["postgres://u@127.0.0.1/runlayer_dev", "runlayer_dev", { database: "runlayer_dev", transport: "tcp", port: 5432 }],
        ["postgresql://u:p@127.0.0.5:5433/runlayer_dev", "runlayer_dev", { database: "runlayer_dev", transport: "tcp", port: 5433 }],
        ["postgresql://u:p@[::1]:5432/runlayer_dev", "runlayer_dev", { database: "runlayer_dev", transport: "tcp", port: 5432 }],
        ["postgresql://u:p@LOCALHOST:5432/runlayer_dev?schema=public&connection_limit=2", "runlayer_dev", { database: "runlayer_dev", transport: "tcp", port: 5432 }],
        ["postgresql://u@localhost/runlayer_dev?host=/tmp", "runlayer_dev", { database: "runlayer_dev", transport: "socket", port: null }],
        ["postgresql:///runlayer_dev?host=/var/run/postgresql&application_name=seed", "runlayer_dev", { database: "runlayer_dev", transport: "socket", port: null }],
        ["postgresql://u:p@localhost:5432/RunLayer_Dev", "RunLayer_Dev", { database: "RunLayer_Dev", transport: "tcp", port: 5432 }],
        ["postgresql://u:p@localhost:5432/runlayer%5Fdev", "runlayer_dev", { database: "runlayer_dev", transport: "tcp", port: 5432 }],
    ];

    for (const [url, confirm, target] of cases) {
        assert.deepEqual(evaluateSeedTarget(withUrl(url, confirm)), { ok: true, target }, url.replace(/:\/\/[^@/]*@/, "://<creds>@"));
    }
});

test("NODE_ENV values other than production do not block a valid local target", () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
        assert.equal(code({ ...base, NODE_ENV }), "ok");
    }
});

// --- production and hosting ----------------------------------------------------

test("production is rejected even for a perfect local target", () => {
    assert.equal(code({ ...base, NODE_ENV: "production" }), "production");
});

test("hosting-provider environments are rejected", () => {
    for (const marker of ["VERCEL", "VERCEL_ENV", "NETLIFY", "RENDER", "RAILWAY_ENVIRONMENT", "FLY_APP_NAME", "K_SERVICE", "AWS_LAMBDA_FUNCTION_NAME", "DYNO", "CF_PAGES"]) {
        assert.equal(code({ ...base, [marker]: "1" }), "hosting_environment", marker);
    }
});

// --- hosted databases (including Supabase) -----------------------------------------

test("hosted Supabase databases are always rejected", () => {
    const hosted = [
        "postgresql://postgres:secret@db.exampleproject.supabase.co:5432/postgres",
        "postgresql://postgres.exampleproject:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true",
        "postgresql://postgres:secret@db.exampleproject.supabase.co:5432/runlayer_dev",
        "postgresql://u:p@db.exampleproject.supabase.co/runlayer_dev?sslmode=require",
        "postgresql://u:p@DB.EXAMPLEPROJECT.SUPABASE.CO:5432/runlayer_dev",
    ];

    for (const url of hosted) {
        assert.equal(code(withUrl(url)), "hosted_database", url.replace(/:\/\/[^@/]*@/, "://<creds>@"));
        // even with a matching confirmation for whatever the database is called
        assert.equal(code(withUrl(url, "postgres")), "hosted_database");
    }
});

test("other hosted providers are rejected as hosted databases", () => {
    for (const host of ["ep-cool-123.us-east-2.aws.neon.tech", "mydb.abc123.us-east-1.rds.amazonaws.com", "myserver.postgres.database.azure.com", "app.railway.app", "db.example.render.com"]) {
        assert.equal(code(withUrl(`postgresql://u:p@${host}:5432/runlayer_dev`)), "hosted_database", host);
    }
});

test("a rejected hosted target never reaches the identity query", async () => {
    let queried = 0;

    await assert.rejects(
        assertSafeSeedTarget({
            env: withUrl("postgresql://postgres:secret@db.exampleproject.supabase.co:5432/postgres", "postgres"),
            queryIdentity: async () => {
                queried += 1;
                return { database: "postgres", address: "10.0.0.1", port: 5432 };
            },
        }),
        (error: unknown) => error instanceof SeedSafetyError && error.code === "hosted_database",
    );
    assert.equal(queried, 0);
});

// --- non-loopback hosts and alternate representations ----------------------------------

test("every non-loopback host is rejected, whatever it resolves to", () => {
    const hosts = [
        "10.0.0.5",
        "192.168.1.5",
        "172.16.0.1",
        "100.64.0.1",
        "0.0.0.0",
        "host.docker.internal",
        "db",
        "postgres",
        "example.com",
        "localhost.evil.example",
        "localhost.",
        "localhost.localdomain",
        "127.1",
        "127.0.1",
        "2130706433",
        "0x7f000001",
        "0177.0.0.1",
        "127.0.0.01",
        "127.0.0.256",
        "127.0.0.1.evil.example",
        "[::ffff:127.0.0.1]",
        "[0:0:0:0:0:0:0:1]",
        "[::2]",
        "[fe80::1%25eth0]",
        "%6cocalhost",
        "loca%6 chost",
    ];

    for (const host of hosts) {
        const result = code(withUrl(`postgresql://u:p@${host}:5432/runlayer_dev`));
        assert.ok(result === "non_loopback_host" || result === "invalid_url" || result === "hosted_database", `${host} -> ${result}`);
        assert.notEqual(result, "ok", host);
    }
});

test("userinfo, multi-host and delimiter tricks cannot smuggle a remote host past the parser", () => {
    const tricks = [
        "postgresql://localhost:5432@evil.example.com/runlayer_dev",
        "postgresql://localhost@evil.example.com/runlayer_dev",
        "postgresql://user@localhost@evil.example.com/runlayer_dev",
        "postgresql://a:b@evil.example.com@localhost/runlayer_dev",
        "postgresql://localhost,evil.example.com/runlayer_dev",
        "postgresql://localhost:5432,evil.example.com:5432/runlayer_dev",
        "postgresql://evil.example.com,localhost/runlayer_dev",
        "postgresql://localhost\\@evil.example.com/runlayer_dev",
        "postgresql://localhost:5432/runlayer_dev#@evil.example.com",
        "postgresql://localhost:5432/runlayer_dev#",
        " postgresql://localhost:5432/runlayer_dev",
        "postgresql://localhost:5432/runlayer_dev ",
        "postgresql://localhost:5432/runlayer_dev\n",
        "postgresql://local\u0000host:5432/runlayer_dev",
        "postgresql://lоcalhost:5432/runlayer_dev",
        "postgresql://localhost:5432/runlayer_dev/../postgres",
        "postgresql://localhost:5432/runlayer_dev/x",
    ];

    for (const url of tricks) {
        assert.notEqual(code(withUrl(url)), "ok", JSON.stringify(url));
    }
});

test("query parameters that can redirect the connection are rejected", () => {
    const redirects = [
        "?host=evil.example.com",
        "?host=localhost",
        "?host=/tmp/../etc",
        "?host=relative/path",
        "?host=%2Ftmp%2F..%2Fx",
        "?host=/tmp&host=/var",
        "?hostaddr=8.8.8.8",
        "?port=5433",
        "?dbname=postgres",
        "?user=postgres",
        "?password=x",
        "?service=remote",
        "?options=-c%20search_path%3Dx",
        "?target_session_attrs=any",
        "?%68ost=evil.example.com",
        "?HOSTADDR=8.8.8.8",
        "?schema=a&schema=b",
        "?&",
        "?sslmode=require&&schema=public",
        "?%ZZ=1",
    ];

    for (const query of redirects) {
        assert.equal(code(withUrl(`postgresql://u:p@localhost:5432/runlayer_dev${query}`)), "unsafe_query", query);
    }

    assert.equal(code(withUrl("postgresql://u:p@evil.example.com/runlayer_dev?host=/tmp")), "non_loopback_host", "a socket parameter does not excuse a remote host");
});

test("socket configuration requires an absolute, traversal-free path", () => {
    assert.equal(code(withUrl("postgresql:///runlayer_dev")), "invalid_url", "no host and no socket");
    assert.equal(code(withUrl("postgresql://localhost/runlayer_dev?host=/Users/me/Library/Application Support/Postgres")), "invalid_url", "raw spaces are not allowed");
    assert.equal(code(withUrl("postgresql://localhost/runlayer_dev?host=/Users/me/Library/Application%20Support/Postgres")), "ok");
    assert.equal(code(withUrl("postgresql://localhost/runlayer_dev?host=/a/../b")), "unsafe_query");
});

test("malformed ports, schemes and lengths are rejected", () => {
    for (const port of ["0", "65536", "abc", "", "-1", "5432x"]) {
        assert.equal(code(withUrl(`postgresql://u:p@localhost:${port}/runlayer_dev`)), "invalid_url", `port ${JSON.stringify(port)}`);
    }

    assert.equal(code(withUrl("mysql://u:p@localhost:3306/runlayer_dev")), "unsupported_protocol");
    assert.equal(code(withUrl("http://localhost/runlayer_dev")), "unsupported_protocol");
    assert.equal(code(withUrl("POSTGRESQL://u:p@localhost/runlayer_dev")), "unsupported_protocol");
    assert.equal(code(withUrl("jdbc:postgresql://localhost/runlayer_dev")), "invalid_url");
    assert.equal(code(withUrl("localhost/runlayer_dev")), "invalid_url");
    assert.equal(code(withUrl(`postgresql://u:p@localhost:5432/runlayer_dev?schema=${"a".repeat(3000)}`)), "invalid_url");
    assert.equal(code({ RUNLAYER_SEED_CONFIRM_DATABASE: CONFIRM }), "missing_url");
    assert.equal(code({ ...base, DATABASE_URL: "" }), "missing_url");
});

// --- database name and confirmation -------------------------------------------------------

test("only dedicated runlayer databases are accepted, never generic or maintenance names", () => {
    for (const name of ["postgres", "template0", "template1", "myapp", "production", "app_runlayer", "runlayer;drop", "runlayer.dev", "runlayer%00", "", "x".repeat(10)]) {
        const url = `postgresql://u:p@localhost:5432/${name}`;
        const result = code(withUrl(url, name));
        assert.ok(result === "invalid_database_name" || result === "invalid_url", `${name} -> ${result}`);
    }

    assert.equal(code(withUrl(`postgresql://u:p@localhost:5432/runlayer${"x".repeat(56)}`, `runlayer${"x".repeat(56)}`)), "invalid_database_name", "64+ characters");
});

test("an exact database-name confirmation is required", () => {
    assert.equal(code({ DATABASE_URL: base.DATABASE_URL }), "missing_confirmation");
    assert.equal(code({ ...base, RUNLAYER_SEED_CONFIRM_DATABASE: "" }), "missing_confirmation");

    for (const confirm of ["Runlayer_dev", " runlayer_dev", "runlayer_dev ", "runlayer_dev\n", "runlayer_de", "runlayer_dev2", "runlayer"]) {
        assert.equal(code({ ...base, RUNLAYER_SEED_CONFIRM_DATABASE: confirm }), "confirmation_mismatch", JSON.stringify(confirm));
    }
});

test("there is no override: force-style variables never change a rejection", () => {
    const overrides = { ALLOW_SEED: "1", FORCE: "1", SEED_FORCE: "1", FORCE_SEED: "true", RUNLAYER_ALLOW_PRODUCTION: "1", RUNLAYER_ALLOW_DB_TESTS: "1", ALLOW_HOSTED: "1", CONFIRM: "yes", I_KNOW_WHAT_I_AM_DOING: "1" };
    const hosted = withUrl("postgresql://postgres:secret@db.exampleproject.supabase.co:5432/postgres", "postgres");

    assert.equal(code({ ...hosted, ...overrides }), "hosted_database");
    assert.equal(code({ ...base, ...overrides, NODE_ENV: "production" }), "production");
    assert.equal(code({ ...withUrl("postgresql://u:p@10.0.0.5:5432/runlayer_dev"), ...overrides }), "non_loopback_host");
});

test("rejection messages are fixed strings that never contain the URL, host, credentials or password", () => {
    const secrets = ["s3cr3t-pw-xyz", "exampleproject", "supabase.co", "evil.example.com", "10.9.8.7", "dbuser"];
    const urls = [
        "postgresql://dbuser:s3cr3t-pw-xyz@db.exampleproject.supabase.co:5432/postgres",
        "postgresql://dbuser:s3cr3t-pw-xyz@evil.example.com:5432/runlayer_dev",
        "postgresql://dbuser:s3cr3t-pw-xyz@10.9.8.7:5432/runlayer_dev",
        "postgresql://dbuser:s3cr3t-pw-xyz@localhost:5432/runlayer_dev?hostaddr=10.9.8.7",
        "postgresql://dbuser:s3cr3t-pw-xyz@localhost:5432/other",
        "postgresql://dbuser:s3cr3t-pw-xyz@localhost:5432/runlayer_dev",
    ];

    for (const url of urls) {
        for (const env of [withUrl(url), { ...withUrl(url), NODE_ENV: "production" }, withUrl(url, "wrong")]) {
            const verdict = evaluateSeedTarget(env);
            if (verdict.ok) continue;
            for (const secret of secrets) {
                assert.ok(!verdict.message.includes(secret), `${verdict.code} leaked ${secret}`);
            }
        }
    }
});

// --- server identity -------------------------------------------------------------------------

const tcpTarget: SeedTarget = { database: "runlayer_dev", transport: "tcp", port: 5432 };
const socketTarget: SeedTarget = { database: "runlayer_dev", transport: "socket", port: null };

function identity(overrides: Partial<ServerIdentity> = {}): ServerIdentity {
    return { database: "runlayer_dev", address: "127.0.0.1", port: 5432, ...overrides };
}

test("the reported server identity must match a tcp target", () => {
    for (const address of ["127.0.0.1", "127.0.0.2", "::1", "127.0.0.1/32", "::1/128"]) {
        assert.deepEqual(evaluateServerIdentity(identity({ address }), tcpTarget), { ok: true }, address);
    }
});

test("identity mismatches are rejected: wrong database, remote address, wrong port", () => {
    const wrongDatabase = evaluateServerIdentity(identity({ database: "postgres" }), tcpTarget);
    const remote = evaluateServerIdentity(identity({ address: "10.20.30.40" }), tcpTarget);
    const publicAddress = evaluateServerIdentity(identity({ address: "203.0.113.9" }), tcpTarget);
    const wrongPort = evaluateServerIdentity(identity({ port: 6543 }), tcpTarget);

    for (const verdict of [wrongDatabase, remote, publicAddress, wrongPort]) {
        assert.equal(verdict.ok, false);
        assert.equal(verdict.ok ? "" : verdict.code, "identity_mismatch");
    }
});

test("a localhost URL that is really a tunnel to a remote server is caught by the server's own address", () => {
    // The URL says localhost, but the server on the other end reports its real, non-loopback address.
    const verdict = evaluateServerIdentity(identity({ address: "10.0.4.17", port: 5432 }), tcpTarget);

    assert.equal(verdict.ok, false);
});

test("an identity that cannot be verified fails closed", () => {
    for (const unverifiable of [null, undefined, { database: null, address: "127.0.0.1", port: 5432 }, identity({ address: null })]) {
        const verdict = evaluateServerIdentity(unverifiable as ServerIdentity | null | undefined, tcpTarget);
        assert.equal(verdict.ok, false);
        assert.equal(verdict.ok ? "" : verdict.code, "identity_unverified");
    }
});

test("socket targets accept a null or loopback address and reject a remote one", () => {
    assert.deepEqual(evaluateServerIdentity({ database: "runlayer_dev", address: null, port: null }, socketTarget), { ok: true });
    assert.deepEqual(evaluateServerIdentity({ database: "runlayer_dev", address: "127.0.0.1", port: 5432 }, socketTarget), { ok: true });
    assert.equal(evaluateServerIdentity({ database: "runlayer_dev", address: "10.0.0.9", port: 5432 }, socketTarget).ok, false);
    assert.equal(evaluateServerIdentity({ database: "other", address: null, port: null }, socketTarget).ok, false);
});

test("assertSafeSeedTarget verifies the identity after the static checks and fails closed on any problem", async () => {
    let queries = 0;
    const good = async () => {
        queries += 1;
        return identity();
    };

    assert.deepEqual(await assertSafeSeedTarget({ env: base, queryIdentity: good }), { database: "runlayer_dev", transport: "tcp", port: 5432 });
    assert.equal(queries, 1);

    const tunnel = assertSafeSeedTarget({ env: base, queryIdentity: async () => identity({ address: "10.0.0.9" }) });
    await assert.rejects(tunnel, (error: unknown) => error instanceof SeedSafetyError && error.code === "identity_mismatch");

    const garbage = assertSafeSeedTarget({ env: base, queryIdentity: async () => undefined as unknown as ServerIdentity });
    await assert.rejects(garbage, (error: unknown) => error instanceof SeedSafetyError && error.code === "identity_unverified");
});

test("when the identity query fails, the seed is refused without echoing the underlying error", async () => {
    const failing = assertSafeSeedTarget({
        env: base,
        queryIdentity: async () => {
            throw new Error("connect ECONNREFUSED postgresql://dbuser:s3cr3t-pw-xyz@db.exampleproject.supabase.co:5432/postgres");
        },
    });

    await assert.rejects(failing, (error: unknown) => {
        assert.ok(error instanceof SeedSafetyError);
        assert.equal(error.code, "identity_unverified");
        assert.ok(!error.message.includes("s3cr3t") && !error.message.includes("supabase") && !error.message.includes("ECONNREFUSED"));
        return true;
    });
});

// --- seed password policy -------------------------------------------------------------------

const EMAIL = "user@example.com";
const LEGACY_DEFAULT = ["Pass", "word123"].join("");

test("a strong password supplied through the environment is accepted", () => {
    for (const password of ["k9#Vq2-Lm7!xR4tZ", "correct horse battery staple 42", "Zx8$mQ1vN5&pL3wY"]) {
        assert.equal(validateSeedPassword(password, EMAIL), null, password.length.toString());
    }
});

test("missing, short, long and padded passwords are rejected", () => {
    assert.match(validateSeedPassword(undefined, EMAIL) ?? "", /required/);
    assert.match(validateSeedPassword("", EMAIL) ?? "", /required/);
    assert.match(validateSeedPassword("Ab1!xY9", EMAIL) ?? "", /at least 12/);
    assert.equal(validateSeedPassword("k9#Vq2-Lm7!x", EMAIL), null, "exactly 12 characters is the minimum and is allowed");
    assert.match(validateSeedPassword("a1".repeat(65) + "Q", EMAIL) ?? "", /at most 128/);
    assert.match(validateSeedPassword(" k9#Vq2-Lm7!xR4tZ", EMAIL) ?? "", /whitespace/);
    assert.match(validateSeedPassword("k9#Vq2-Lm7!xR4tZ\n", EMAIL) ?? "", /whitespace/);
});

test("predictable passwords are rejected, including the old hard-coded default", () => {
    const weak = [
        LEGACY_DEFAULT,
        `${LEGACY_DEFAULT}!!!!`,
        "MyPassword!2024",
        "Qwerty-Qwerty-1",
        "letmein-letmein",
        "changeme-please-1",
        "Welcome-to-2024!",
        "administrator-1",
        "1234567890123456",
        "abcdefghijklmnop",
        "RunLayer-Dev-2024",
        "example-example-1",
        "aaaaaaaaaaaaaaaa",
        "abababababab",
        "user@example.com",
        "xx-USER@EXAMPLE.COM-xx",
    ];

    for (const password of weak) {
        assert.notEqual(validateSeedPassword(password, EMAIL), null, `expected rejection (length ${password.length})`);
    }
});

test("password policy messages never contain the password", () => {
    const candidates = ["short", LEGACY_DEFAULT, "aaaaaaaaaaaaaaaa", ` ${"x".repeat(20)}`, "my-distinctive-weak-password-1"];

    for (const password of candidates) {
        const reason = validateSeedPassword(password, EMAIL);
        assert.ok(reason);
        assert.ok(!reason.includes(password));
    }
});
