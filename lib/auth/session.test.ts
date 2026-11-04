import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSessionToken } from "./crypto";
import { describeErrorForLog, handleLogout, resolveSessionUser, revokeSession, type SessionStore } from "./session";

process.env.BETTER_AUTH_SECRET = "a-strong-test-secret-with-more-than-32-chars";
const SECRET = process.env.BETTER_AUTH_SECRET;
const COOKIE = "runlayer_session";

type FakeUser = { id: string; role: string; sessionVersion: number };

/**
 * In-memory store with the same contract as the Prisma one. incrementSessionVersionIfCurrent checks and updates
 * with no await in between, so, like a single SQL UPDATE ... WHERE session_version = ?, concurrent callers cannot
 * both succeed for the same expected version.
 */
function createFakeStore(initial: FakeUser[]) {
    const rows = new Map(initial.map((user) => [user.id, { ...user }]));
    const calls = { finds: 0, increments: 0, attempts: 0 };

    const store: SessionStore<FakeUser> = {
        async findUserById(id) {
            calls.finds += 1;
            await Promise.resolve();
            const row = rows.get(id);
            return row ? { ...row } : null;
        },
        async incrementSessionVersionIfCurrent(id, expectedVersion) {
            calls.attempts += 1;
            await Promise.resolve();
            const row = rows.get(id);
            if (!row || row.sessionVersion !== expectedVersion) return false;
            row.sessionVersion += 1;
            calls.increments += 1;
            return true;
        },
    };

    return { store, rows, calls, version: (id: string) => rows.get(id)?.sessionVersion };
}

const issue = (user: FakeUser) => createSessionToken(user.id, user.sessionVersion);
const freshUsers = (): FakeUser[] => [
    { id: "user-1", role: "USER", sessionVersion: 0 },
    { id: "user-2", role: "USER", sessionVersion: 0 },
];

// --- resolving sessions ----------------------------------------------------

test("a token with the current session version resolves to its user", async () => {
    const { store } = createFakeStore(freshUsers());
    const user = await resolveSessionUser(issue({ id: "user-1", role: "USER", sessionVersion: 0 }), store);

    assert.equal(user?.id, "user-1");
});

test("a missing or invalid token resolves to null without touching the store", async () => {
    const { store, calls } = createFakeStore(freshUsers());
    const valid = issue({ id: "user-1", role: "USER", sessionVersion: 0 });
    const [id, version, expiry, signature] = valid.split(".");

    for (const token of [undefined, "", "garbage", `${id}.${version}.${expiry}.${"0".repeat(signature.length)}`, `${id}.1.${expiry}.${signature}`]) {
        assert.equal(await resolveSessionUser(token, store), null);
    }

    assert.equal(calls.finds, 0, "invalid tokens never reach the database");
});

test("legacy three-part tokens resolve to null immediately", async () => {
    const { store, calls } = createFakeStore(freshUsers());
    const payload = `user-1.${Date.now() + 60_000}`;
    const legacy = `${payload}.${createHmac("sha256", SECRET).update(payload).digest("hex")}`;

    assert.equal(await resolveSessionUser(legacy, store), null);
    assert.equal(calls.finds, 0);
});

test("an out-of-date version and a version ahead of the stored one are both rejected", async () => {
    const { store, rows } = createFakeStore(freshUsers());
    const old = issue({ id: "user-1", role: "USER", sessionVersion: 0 });
    const ahead = issue({ id: "user-1", role: "USER", sessionVersion: 5 });

    rows.get("user-1")!.sessionVersion = 1;

    assert.equal(await resolveSessionUser(old, store), null, "older than stored");
    assert.equal(await resolveSessionUser(ahead, store), null, "newer than stored");
    assert.ok(await resolveSessionUser(issue({ id: "user-1", role: "USER", sessionVersion: 1 }), store));
});

test("a token for a deleted user resolves to null", async () => {
    const { store, rows } = createFakeStore(freshUsers());
    const token = issue({ id: "user-1", role: "USER", sessionVersion: 0 });

    rows.delete("user-1");

    assert.equal(await resolveSessionUser(token, store), null);
});

test("role changes take effect without a new login", async () => {
    const { store, rows } = createFakeStore(freshUsers());
    const token = issue({ id: "user-1", role: "USER", sessionVersion: 0 });

    assert.equal((await resolveSessionUser(token, store))?.role, "USER");
    rows.get("user-1")!.role = "ADMIN";
    assert.equal((await resolveSessionUser(token, store))?.role, "ADMIN");
    rows.get("user-1")!.role = "USER";
    assert.equal((await resolveSessionUser(token, store))?.role, "USER", "demotion is immediate");
});

// --- revocation --------------------------------------------------------------

test("logout revokes the session: the version rises by exactly one and the previous token is rejected", async () => {
    const harness = createFakeStore(freshUsers());
    const token = issue({ id: "user-1", role: "USER", sessionVersion: 0 });

    assert.ok(await resolveSessionUser(token, harness.store));
    assert.equal(await revokeSession(token, harness.store), "revoked");

    assert.equal(harness.version("user-1"), 1);
    assert.equal(await resolveSessionUser(token, harness.store), null, "replaying the previously issued token fails");
});

test("replaying a revoked token again is idempotent and changes nothing", async () => {
    const harness = createFakeStore(freshUsers());
    const token = issue({ id: "user-1", role: "USER", sessionVersion: 0 });

    await revokeSession(token, harness.store);

    for (let attempt = 0; attempt < 5; attempt += 1) {
        assert.equal(await revokeSession(token, harness.store), "stale");
        assert.equal(await resolveSessionUser(token, harness.store), null);
    }

    assert.equal(harness.version("user-1"), 1);
    assert.equal(harness.calls.increments, 1);
});

test("signing in again after logout works with the new version", async () => {
    const harness = createFakeStore(freshUsers());

    await revokeSession(issue({ id: "user-1", role: "USER", sessionVersion: 0 }), harness.store);

    const fresh = issue({ id: "user-1", role: "USER", sessionVersion: harness.version("user-1")! });
    assert.equal((await resolveSessionUser(fresh, harness.store))?.id, "user-1");
});

test("a stale token cannot revoke a newer session", async () => {
    const harness = createFakeStore(freshUsers());
    const stolenOldToken = issue({ id: "user-1", role: "USER", sessionVersion: 0 });

    await revokeSession(stolenOldToken, harness.store); // the user logs out; version is now 1
    const currentToken = issue({ id: "user-1", role: "USER", sessionVersion: harness.version("user-1")! });

    assert.equal(await revokeSession(stolenOldToken, harness.store), "stale", "the old token's logout is a no-op");
    assert.equal(harness.version("user-1"), 1);
    assert.ok(await resolveSessionUser(currentToken, harness.store), "the newer session is still valid");
});

test("concurrent logouts with one token increment the version exactly once", async () => {
    const harness = createFakeStore(freshUsers());
    const token = issue({ id: "user-1", role: "USER", sessionVersion: 0 });

    const outcomes = await Promise.all(Array.from({ length: 10 }, () => revokeSession(token, harness.store)));

    assert.equal(outcomes.filter((outcome) => outcome === "revoked").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome === "stale").length, 9);
    assert.equal(harness.version("user-1"), 1);
    assert.equal(harness.calls.increments, 1);
});

test("log out everywhere: every token for the same version is invalidated by one logout", async () => {
    const harness = createFakeStore(freshUsers());
    const laptop = issue({ id: "user-1", role: "USER", sessionVersion: 0 });
    const phone = issue({ id: "user-1", role: "USER", sessionVersion: 0 });

    assert.ok(await resolveSessionUser(laptop, harness.store));
    assert.ok(await resolveSessionUser(phone, harness.store));

    await revokeSession(laptop, harness.store);

    assert.equal(await resolveSessionUser(laptop, harness.store), null);
    assert.equal(await resolveSessionUser(phone, harness.store), null);
});

test("revoking one user's sessions does not affect another user", async () => {
    const harness = createFakeStore(freshUsers());
    const other = issue({ id: "user-2", role: "USER", sessionVersion: 0 });

    await revokeSession(issue({ id: "user-1", role: "USER", sessionVersion: 0 }), harness.store);

    assert.ok(await resolveSessionUser(other, harness.store));
    assert.equal(harness.version("user-2"), 0);
});

test("logout with no token, an invalid token or an expired token changes nothing and skips the store", async () => {
    const harness = createFakeStore(freshUsers());
    const expiredPayload = `user-1.0.${Date.now() - 1000}`;
    const expired = `${expiredPayload}.${createHmac("sha256", SECRET).update(`session-v2:${expiredPayload}`).digest("hex")}`;

    for (const token of [undefined, "", "garbage", expired]) {
        assert.equal(await revokeSession(token, harness.store), "no_session");
    }

    assert.equal(harness.calls.attempts, 0);
    assert.equal(harness.version("user-1"), 0);
});

// --- logout handler ------------------------------------------------------------

test("logout responds with success and clears the cookie with the unchanged security attributes", async () => {
    const harness = createFakeStore(freshUsers());
    const token = issue({ id: "user-1", role: "USER", sessionVersion: 0 });

    for (const secure of [false, true]) {
        const response = await handleLogout(token, { store: harness.store, cookieName: COOKIE, secure });
        const cookie = response.cookies.get(COOKIE);
        const raw = response.headers.get("set-cookie") ?? "";

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, redirectTo: "/login" });
        assert.equal(cookie?.value, "");
        assert.equal(cookie?.httpOnly, true);
        assert.equal(cookie?.sameSite, "lax");
        assert.equal(cookie?.path, "/");
        assert.equal(cookie?.maxAge, 0);
        assert.equal(Boolean(cookie?.secure), secure);
        assert.match(raw, /HttpOnly/i);
        assert.match(raw, /Max-Age=0/i);
    }
});

test("logout is idempotent: repeating it succeeds and increments once", async () => {
    const harness = createFakeStore(freshUsers());
    const token = issue({ id: "user-1", role: "USER", sessionVersion: 0 });

    const first = await handleLogout(token, { store: harness.store, cookieName: COOKIE, secure: false });
    const second = await handleLogout(token, { store: harness.store, cookieName: COOKIE, secure: false });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(harness.version("user-1"), 1);
});

test("logout without a session still clears the cookie and succeeds", async () => {
    const harness = createFakeStore(freshUsers());
    const response = await handleLogout(undefined, { store: harness.store, cookieName: COOKIE, secure: false });

    assert.equal(response.status, 200);
    assert.equal(response.cookies.get(COOKIE)?.maxAge, 0);
    assert.equal(harness.calls.attempts, 0);
});

test("when revocation fails, the cookie is cleared but the response is HTTP 500 and does not claim success", async () => {
    const harness = createFakeStore(freshUsers());
    const failing: SessionStore<FakeUser> = {
        findUserById: harness.store.findUserById,
        incrementSessionVersionIfCurrent: async () => {
            throw new Error("connection refused for user-1 with token details");
        },
    };
    const reported: unknown[] = [];
    const token = issue({ id: "user-1", role: "USER", sessionVersion: 0 });

    const response = await handleLogout(token, { store: failing, cookieName: COOKIE, secure: true, onError: (error) => reported.push(error) });
    const text = await response.text();

    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(text), { success: false, error: { code: "LOGOUT_FAILED", message: "Unable to end the session. Please try again." } });
    assert.equal(response.cookies.get(COOKIE)?.value, "", "the browser cookie is still cleared");
    assert.equal(response.cookies.get(COOKIE)?.maxAge, 0);
    assert.ok(!text.includes("user-1") && !text.includes("connection refused") && !text.includes(token), "nothing sensitive in the response");
    assert.equal(reported.length, 1);
    assert.equal(harness.version("user-1"), 0, "the session was not revoked, and the response says so");
});

// --- safe logging ---------------------------------------------------------------

test("describeErrorForLog reports only the error type and database code, never the message", () => {
    class PrismaClientKnownRequestError extends Error {
        constructor(message: string, public code: string) {
            super(message);
            this.name = "PrismaClientKnownRequestError";
        }
    }

    const dbError = new PrismaClientKnownRequestError('Invalid `prisma.user.updateMany()` invocation: where: { id: "user-1" }', "P2025");
    assert.equal(describeErrorForLog(dbError), "PrismaClientKnownRequestError:P2025");
    assert.ok(!describeErrorForLog(dbError).includes("user-1"));

    assert.equal(describeErrorForLog(new TypeError("secret detail")), "TypeError");
    assert.equal(describeErrorForLog("a string with user-1"), "UnknownError");
    assert.equal(describeErrorForLog(null), "UnknownError");

    const weirdCode = Object.assign(new Error("x"), { code: "has spaces and user-1" });
    assert.equal(describeErrorForLog(weirdCode), "Error", "an unsafe code is dropped");
});

// --- wiring and migration guards ----------------------------------------------------

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("login and signup issue tokens carrying the stored session version", () => {
    for (const path of ["app/api/auth/login/route.ts", "app/api/auth/signup/route.ts"]) {
        const source = read(path);

        assert.match(source, /sessionVersion: true/, `${path} selects sessionVersion`);
        assert.match(source, /createSessionToken\(user\.id, user\.sessionVersion\)/, `${path} passes it to the token`);
        assert.doesNotMatch(source, /console\.error\([^)]*,\s*error\)/, `${path} does not log raw error objects`);
    }
});

test("logout and session lookup go through the revocation logic", () => {
    const logout = read("app/api/auth/logout/route.ts");
    const auth = read("lib/auth.ts");

    assert.match(logout, /handleLogout\(request\.cookies\.get\(name\)\?\.value/);
    assert.match(logout, /describeErrorForLog/);
    const store = read("lib/auth/prismaSessionStore.ts");

    assert.match(auth, /resolveSessionUser\(token, sessionStore\)/);
    assert.match(auth, /createPrismaSessionStore\(prisma\)/);
    assert.match(store, /where: \{ id, sessionVersion: expectedVersion \}/, "the increment is guarded by the expected version");
    assert.match(store, /increment: 1/);
});

test("the proxy documents that it does not establish revocation status", () => {
    assert.match(read("proxy.ts"), /does NOT establish that a session is still valid/);
});

test("the migration is the single additive column and nothing else", () => {
    const sql = read("prisma/migrations/20261104160000_add_user_session_version/migration.sql");
    const statements = sql
        .split("\n")
        .filter((line) => line.trim() && !line.trim().startsWith("--"))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

    assert.equal(statements, 'ALTER TABLE "users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;');
    assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE|UPDATE/i);
});
