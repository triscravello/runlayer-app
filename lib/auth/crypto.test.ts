import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createSessionToken, verifySessionToken } from "./crypto";
import { DEV_FALLBACK_AUTH_SECRET, MIN_AUTH_SECRET_LENGTH, resolveAuthSecret } from "./secret";

const STRONG_SECRET = "a-strong-test-secret-with-more-than-32-chars";
const OTHER_SECRET = "another-strong-test-secret-with-32plus-chars";

function withSecret<T>(secret: string | undefined, run: () => T): T {
    const previous = process.env.BETTER_AUTH_SECRET;
    if (secret === undefined) {
        delete process.env.BETTER_AUTH_SECRET;
    } else {
        process.env.BETTER_AUTH_SECRET = secret;
    }

    try {
        return run();
    } finally {
        if (previous === undefined) {
            delete process.env.BETTER_AUTH_SECRET;
        } else {
            process.env.BETTER_AUTH_SECRET = previous;
        }
    }
}

function signToken(userId: string, expiresAt: number, secret: string) {
    const payload = `${userId}.${expiresAt}`;
    return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

// --- resolveAuthSecret ---------------------------------------------------

test("resolveAuthSecret uses the dev fallback only when NODE_ENV is development", () => {
    assert.equal(resolveAuthSecret({ NODE_ENV: "development" }), DEV_FALLBACK_AUTH_SECRET);
    assert.equal(resolveAuthSecret({ NODE_ENV: "development", BETTER_AUTH_SECRET: "short" }), "short");
});

test("resolveAuthSecret rejects a missing secret outside development", () => {
    for (const NODE_ENV of ["production", "test", "staging", "preview", undefined]) {
        assert.throws(
            () => resolveAuthSecret({ NODE_ENV }),
            /Missing BETTER_AUTH_SECRET/,
            `expected a throw for NODE_ENV=${String(NODE_ENV)}`,
        );
    }
});

test("resolveAuthSecret treats an empty secret as missing outside development", () => {
    assert.throws(() => resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: "" }), /Missing BETTER_AUTH_SECRET/);
});

test("resolveAuthSecret rejects the dev fallback value outside development", () => {
    for (const NODE_ENV of ["production", "test", "staging", undefined]) {
        assert.throws(
            () => resolveAuthSecret({ NODE_ENV, BETTER_AUTH_SECRET: DEV_FALLBACK_AUTH_SECRET }),
            /development fallback/,
        );
    }
});

test("resolveAuthSecret enforces the minimum length outside development", () => {
    const tooShort = "x".repeat(MIN_AUTH_SECRET_LENGTH - 1);
    const justRight = "x".repeat(MIN_AUTH_SECRET_LENGTH);

    assert.throws(() => resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: tooShort }), /at least 32 characters/);
    assert.equal(resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: justRight }), justRight);
});

test("resolveAuthSecret error messages never include the secret value", () => {
    const secret = "very-distinctive-short-secret";

    try {
        resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: secret });
        assert.fail("expected resolveAuthSecret to throw");
    } catch (error) {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes(secret));
    }
});

// --- session tokens ------------------------------------------------------

test("a session token round-trips with a strong secret", () => {
    withSecret(STRONG_SECRET, () => {
        const token = createSessionToken("user-1");
        const session = verifySessionToken(token);

        assert.equal(session?.userId, "user-1");
        assert.ok(session && session.expiresAt > Date.now());
    });
});

test("a token signed with a different secret is rejected", () => {
    const token = withSecret(OTHER_SECRET, () => createSessionToken("user-1"));

    withSecret(STRONG_SECRET, () => {
        assert.equal(verifySessionToken(token), null);
    });
});

test("a tampered user id or signature is rejected", () => {
    withSecret(STRONG_SECRET, () => {
        const [userId, expiresAt, signature] = createSessionToken("user-1").split(".");

        assert.equal(verifySessionToken(`user-2.${expiresAt}.${signature}`), null);
        assert.equal(verifySessionToken(`${userId}.${expiresAt}.${"0".repeat(signature.length)}`), null);
        assert.equal(verifySessionToken(`${userId}.${expiresAt}.${signature.slice(0, -2)}`), null);
        assert.equal(verifySessionToken(`${userId}.${Number(expiresAt) + 1000}.${signature}`), null);
    });
});

test("an expired token is rejected even when correctly signed", () => {
    withSecret(STRONG_SECRET, () => {
        assert.equal(verifySessionToken(signToken("user-1", Date.now() - 1000, STRONG_SECRET)), null);
        assert.ok(verifySessionToken(signToken("user-1", Date.now() + 60_000, STRONG_SECRET)));
    });
});

test("malformed tokens are rejected", () => {
    withSecret(STRONG_SECRET, () => {
        for (const token of ["", "abc", "a.b", "a.b.c.d", "user-1.notanumber.deadbeef", "user-1.9999999999999.not-hex"]) {
            assert.equal(verifySessionToken(token), null, `expected null for ${JSON.stringify(token)}`);
        }
    });
});

test(
    "creating a token without a secret throws outside development instead of using a known key",
    { skip: process.env.NODE_ENV === "development" },
    () => {
        withSecret(undefined, () => {
            assert.throws(() => createSessionToken("user-1"), /Missing BETTER_AUTH_SECRET/);
            assert.throws(() => verifySessionToken(signToken("user-1", Date.now() + 60_000, DEV_FALLBACK_AUTH_SECRET)), /Missing BETTER_AUTH_SECRET/);
        });
    },
);

test(
    "a token forged with the public dev fallback secret is not accepted with a strong secret configured",
    () => {
        withSecret(STRONG_SECRET, () => {
            const forged = signToken("admin-user", Date.now() + 60_000, DEV_FALLBACK_AUTH_SECRET);
            assert.equal(verifySessionToken(forged), null);
        });
    },
);
