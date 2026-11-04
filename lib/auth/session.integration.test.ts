import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createSessionToken } from "./crypto";
import { createPrismaSessionStore } from "./prismaSessionStore";
import { resolveSessionUser, revokeSession } from "./session";
import { checkTestDatabase } from "./testDatabaseGuard";

/**
 * Session revocation against a REAL PostgreSQL database. Skipped by default.
 *
 * To run it, point it at a dedicated, throwaway local database whose schema already includes the
 * session_version migration (this test never applies migrations and never touches DATABASE_URL):
 *
 *   RUNLAYER_ALLOW_DB_TESTS=1 \
 *   RUNLAYER_TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/runlayer_session_test \
 *   npx tsx --test lib/auth/session.integration.test.ts
 *
 * Safeguards (lib/auth/testDatabaseGuard.ts): explicit opt-in, local host only, database name must contain
 * "test", and it must differ from DATABASE_URL. It creates one clearly-marked user row and deletes it afterwards.
 */
const check = checkTestDatabase(process.env);

test(
    "session revocation against a real PostgreSQL database",
    { skip: check.ok ? false : `skipped: ${check.reason}` },
    async () => {
        assert.ok(check.ok);

        process.env.BETTER_AUTH_SECRET = "a-strong-test-secret-with-more-than-32-chars";
        const client = new PrismaClient({ datasources: { db: { url: check.url } } });
        const store = createPrismaSessionStore(client);
        const email = `session-integration-${randomUUID()}@example.invalid`;
        let userId: string | undefined;

        try {
            // Read-only target check before anything is written: the server we actually reached must report the
            // intended database name and port. This guards against a client that ignores the override and falls
            // back to the DATABASE_URL in .env.
            const target = new URL(check.url);
            const [reached] = await client.$queryRaw<Array<{ db: string; port: number | null }>>`select current_database() as db, inet_server_port() as port`;
            assert.equal(reached.db, decodeURIComponent(target.pathname.replace(/^\//, "")), "connected to the intended database");
            assert.equal(Number(reached.port), Number(target.port || 5432), "connected to the intended server port");

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
        } finally {
            if (userId) {
                await client.user.deleteMany({ where: { id: userId } });
            }
            await client.$disconnect();
        }
    },
);
