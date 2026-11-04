type EnvSource = Readonly<Record<string, string | undefined>>;

export type TestDatabaseCheck = { ok: true; url: string } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function target(url: URL) {
    return `${url.hostname.toLowerCase()}:${url.port || "5432"}/${decodeURIComponent(url.pathname.replace(/^\//, ""))}`;
}

/**
 * Decides whether a database integration test may run. Every safeguard must pass:
 * - RUNLAYER_ALLOW_DB_TESTS=1 is set explicitly;
 * - RUNLAYER_TEST_DATABASE_URL (a dedicated variable, never DATABASE_URL) is a PostgreSQL URL;
 * - its host is local (localhost, 127.0.0.1 or ::1);
 * - its database name contains "test";
 * - it does not point at the same host, port and database as DATABASE_URL.
 * Reasons never contain the URL or its credentials.
 */
export function checkTestDatabase(env: EnvSource): TestDatabaseCheck {
    if (env.RUNLAYER_ALLOW_DB_TESTS !== "1") {
        return { ok: false, reason: "database tests are not enabled (set RUNLAYER_ALLOW_DB_TESTS=1)" };
    }

    const raw = env.RUNLAYER_TEST_DATABASE_URL?.trim();
    if (!raw) {
        return { ok: false, reason: "RUNLAYER_TEST_DATABASE_URL is not set" };
    }

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { ok: false, reason: "RUNLAYER_TEST_DATABASE_URL is not a valid URL" };
    }

    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
        return { ok: false, reason: "RUNLAYER_TEST_DATABASE_URL must be a PostgreSQL URL" };
    }

    if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
        return { ok: false, reason: "RUNLAYER_TEST_DATABASE_URL must point at a local host" };
    }

    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!/test/i.test(database)) {
        return { ok: false, reason: 'the test database name must contain "test"' };
    }

    const appUrl = env.DATABASE_URL?.trim();
    if (appUrl) {
        try {
            if (target(new URL(appUrl)) === target(url)) {
                return { ok: false, reason: "the test database must differ from DATABASE_URL" };
            }
        } catch {
            // An unparsable DATABASE_URL cannot be the same target.
        }
    }

    return { ok: true, url: raw };
}
