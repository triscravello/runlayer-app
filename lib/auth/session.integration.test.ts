import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createSessionToken } from "./crypto";
import { createPrismaSessionStore } from "./prismaSessionStore";
import { resolveSessionUser, revokeSession } from "./session";
import { resolveTestDatabase } from "./testDatabaseGuard";
import { combineFailures, runMarkerCleanup } from "../../test-support/isolation/markerCleanup";
import { expectedDataDirectoryFromEnv, expectedIdentityFor, verifyConnectedIdentity, type ConnectedFacts } from "../../test-support/isolation/connectedIdentity";

/**
 * Session revocation against a REAL PostgreSQL database. Skipped by default.
 *
 * To run it, point it at a dedicated, throwaway local database whose schema already includes the
 * session_version migration (this test never applies migrations and never touches DATABASE_URL):
 *
 *   RUNLAYER_ALLOW_DB_TESTS=1 \
 *   RUNLAYER_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:PORT/runlayer_<name>_test \
 *   RUNLAYER_DISPOSABLE_URL=<the same host, port and database> \
 *   RUNLAYER_DISPOSABLE_DATA_DIR=<the disposable cluster's canonical data directory> \
 *   node scripts/runTests.mjs --integration lib/auth/session.integration.test.ts
 *
 * The target must be a literal loopback IP on an explicit port that is not 5432 or 6543, with a database name matching
 * runlayer_..._test_... (never `localhost`). The runner also requires RUNLAYER_DISPOSABLE_URL to name the same database and passes the
 * wrapper's data directory on as RUNLAYER_TEST_EXPECTED_DATA_DIR; run without the runner, set that variable yourself, because every
 * suite checks the live server's database, port, address AND data directory before it writes anything. With RUNLAYER_ALLOW_DB_TESTS=1
 * an invalid target FAILS loudly before any connection; without it the suite skips. See README "Testing".
 *
 * Safeguards (lib/auth/testDatabaseGuard.ts): explicit opt-in, local host only, database name must contain
 * "test", and it must differ from DATABASE_URL. It creates one clearly-marked user row and deletes it afterwards.
 */
const check = resolveTestDatabase(process.env);

test(
    "session revocation against a real PostgreSQL database",
    { skip: check.ok ? false : `skipped: ${check.reason}` },
    async () => {
        assert.ok(check.ok);

        process.env.BETTER_AUTH_SECRET = "a-strong-test-secret-with-more-than-32-chars";
        const client = new PrismaClient({ datasources: { db: { url: check.url } } });
        const store = createPrismaSessionStore(client);
        const email = `session-integration-${randomUUID()}@example.invalid`;
        // Re-run before ANY cleanup: a check made when the suite started says nothing about the server that answers now.
        const verifyIdentity = () =>
            verifyConnectedIdentity(
                async () => (await client.$queryRaw<ConnectedFacts[]>`select current_database() as db, inet_server_port() as port, host(inet_server_addr()) as addr, current_setting('data_directory') as "dataDirectory"`)[0] as ConnectedFacts,
                expectedIdentityFor(check.url, expectedDataDirectoryFromEnv(process.env)),
            );
        let userId: string | undefined;
        let verified = false;
        let primaryFailure: unknown;

        try {
            // Live identity check (database, port, loopback address AND data directory) before anything is written.
            await verifyIdentity();
            verified = true;

            const created = await client.user.create({ data: { email, passwordHash: "integration-test-not-a-real-hash" } });
            userId = created.id;
            assert.equal(created.sessionVersion, 0, "new users start at version 0");

            const token = createSessionToken(created.id, created.sessionVersion);
            assert.equal((await resolveSessionUser(token, store))?.id, created.id);

            assert.equal(await revokeSession(token, store), "revoked");
            assert.equal((await client.user.findUniqueOrThrow({ where: { id: created.id } })).sessionVersion, 1);
            assert.equal(await resolveSessionUser(token, store), null, "the previously issued token is rejected");

            assert.equal(await revokeSession(token, store), "stale", "replay is a no-op");
            assert.equal((await client.user.findUniqueOrThrow({ where: { id: created.id } })).sessionVersion, 1);

            // A session issued after the revocation works, while the stale one stays revoked.
            const current = createSessionToken(created.id, 1);
            assert.equal((await resolveSessionUser(current, store))?.id, created.id, "a freshly issued session works after revocation");
            assert.equal(await resolveSessionUser(token, store), null, "the stale session stays revoked");

            // Real database atomicity: concurrent logouts with one token increment exactly once.
            const outcomes = await Promise.all(Array.from({ length: 10 }, () => revokeSession(current, store)));

            assert.equal(outcomes.filter((outcome) => outcome === "revoked").length, 1);
            assert.equal(outcomes.filter((outcome) => outcome === "stale").length, 9);
            assert.equal((await client.user.findUniqueOrThrow({ where: { id: created.id } })).sessionVersion, 2);

            // Everything issued so far is revoked; a token for the new version works.
            assert.equal(await resolveSessionUser(current, store), null);
            assert.equal(await resolveSessionUser(token, store), null);
            assert.equal((await resolveSessionUser(createSessionToken(created.id, 2), store))?.id, created.id);

            // A stale token cannot revoke the newer session.
            assert.equal(await revokeSession(token, store), "stale");
            assert.equal((await client.user.findUniqueOrThrow({ where: { id: created.id } })).sessionVersion, 2);
        } catch (error) {
            primaryFailure = error;
            throw error;
        } finally {
            // Cleanup runs only after the server verifies AGAIN; a refusal or failure is reported next to the test's own failure, never instead of it.
            let cleanupFailure: unknown;
            try {
                await runMarkerCleanup({ marker: email, verified, verify: verifyIdentity, deletions: userId ? [() => client.user.deleteMany({ where: { id: userId as string } })] : [] });
            } catch (error) {
                cleanupFailure = error;
            }
            await client.$disconnect();
            if (cleanupFailure) throw combineFailures(primaryFailure, cleanupFailure);
        }
    },
);
