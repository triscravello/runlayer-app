import { checkIntegrationTarget } from "../../test-support/isolation/target.cjs";

type EnvSource = Readonly<Record<string, string | undefined>>;

export type TestDatabaseCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Decides whether a database integration test may run. This is the SAME strict policy the launcher and the preload apply
 * (test-support/isolation/target.cjs), so a suite run directly, without scripts/runTests.mjs, is held to it too:
 * - RUNLAYER_ALLOW_DB_TESTS=1 is set explicitly;
 * - RUNLAYER_TEST_DATABASE_URL (a dedicated variable, never DATABASE_URL) is a PostgreSQL URL with a LITERAL loopback IP
 *   (127.x.x.x or [::1], never `localhost`), an explicit port of 1024 or more that is neither 5432 nor 6543, a database name
 *   matching runlayer_..._test_..., and no query options except schema=public and connect_timeout;
 * - it does not point at the same host, port and database as DATABASE_URL.
 * Reasons never contain the URL or its credentials.
 */
export function checkTestDatabase(env: EnvSource): TestDatabaseCheck {
    const verdict = checkIntegrationTarget(env as Record<string, string | undefined>);
    return verdict.ok ? { ok: true, url: verdict.url } : { ok: false, reason: verdict.reason };
}

/**
 * What the integration suites call at import time. Not opted in: a safe skip, exactly as before. Opted in (RUNLAYER_ALLOW_DB_TESTS=1)
 * with an invalid target: THROWS, before any connection, so a misconfiguration is a loud failure and never a silent green skip.
 */
export function resolveTestDatabase(env: EnvSource): TestDatabaseCheck {
    const verdict = checkTestDatabase(env);
    if (!verdict.ok && env.RUNLAYER_ALLOW_DB_TESTS === "1") {
        throw new Error(`integration tests refused: ${verdict.reason}. Nothing was started and no connection was made.`);
    }
    return verdict;
}
