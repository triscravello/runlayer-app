import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { MAX_SESSION_VERSION, createSessionToken, verifySessionToken } from "./crypto";
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

// Builds a correctly signed token from raw strings, so tests can prove that malformed claims are rejected by
// validation and not merely by a bad signature.
function signRaw(userId: string, versionStr: string, expiresAtStr: string, secret: string, domain = "session-v2:") {
    const payload = `${userId}.${versionStr}.${expiresAtStr}`;
    return `${payload}.${createHmac("sha256", secret).update(`${domain}${payload}`).digest("hex")}`;
}

const inOneMinute = () => String(Date.now() + 60_000);

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

test("a session token round-trips and carries the user id and session version", () => {
    withSecret(STRONG_SECRET, () => {
        const token = createSessionToken("user-1", 7);
        const session = verifySessionToken(token);

        assert.equal(token.split(".").length, 4, "userId.sessionVersion.expiresAt.signature");
        assert.equal(session?.userId, "user-1");
        assert.equal(session?.sessionVersion, 7);
        assert.ok(session && session.expiresAt > Date.now());
    });
});

test("the session version is signed: changing any claim invalidates the token", () => {
    withSecret(STRONG_SECRET, () => {
        const [userId, version, expiresAt, signature] = createSessionToken("user-1", 3).split(".");

        assert.ok(verifySessionToken([userId, version, expiresAt, signature].join(".")));
        assert.equal(verifySessionToken(`user-2.${version}.${expiresAt}.${signature}`), null);
        assert.equal(verifySessionToken(`${userId}.4.${expiresAt}.${signature}`), null, "a bumped version cannot be forged");
        assert.equal(verifySessionToken(`${userId}.2.${expiresAt}.${signature}`), null);
        assert.equal(verifySessionToken(`${userId}.${version}.${Number(expiresAt) + 1000}.${signature}`), null);
        assert.equal(verifySessionToken(`${userId}.${version}.${expiresAt}.${"0".repeat(signature.length)}`), null);
        assert.equal(verifySessionToken(`${userId}.${version}.${expiresAt}.${signature.slice(0, -2)}`), null);
    });
});

test("different versions of one user produce different signatures", () => {
    withSecret(STRONG_SECRET, () => {
        const first = createSessionToken("user-1", 0).split(".");
        const second = createSessionToken("user-1", 1).split(".");

        assert.notEqual(first[3], second[3]);
    });
});

test("a token signed with a different secret is rejected", () => {
    const token = withSecret(OTHER_SECRET, () => createSessionToken("user-1", 0));

    withSecret(STRONG_SECRET, () => {
        assert.equal(verifySessionToken(token), null);
    });
});

test("an expired token is rejected even when correctly signed", () => {
    withSecret(STRONG_SECRET, () => {
        assert.equal(verifySessionToken(signRaw("user-1", "0", String(Date.now() - 1000), STRONG_SECRET)), null);
        assert.ok(verifySessionToken(signRaw("user-1", "0", inOneMinute(), STRONG_SECRET)));
    });
});

test("legacy three-part tokens are rejected immediately", () => {
    withSecret(STRONG_SECRET, () => {
        const expiresAt = Date.now() + 60_000;
        const payload = `user-1.${expiresAt}`;
        const legacy = `${payload}.${createHmac("sha256", STRONG_SECRET).update(payload).digest("hex")}`;

        assert.equal(legacy.split(".").length, 3);
        assert.equal(verifySessionToken(legacy), null);
        assert.equal(verifySessionToken(`${payload}.${createHmac("sha256", STRONG_SECRET).update(`session-v2:${payload}`).digest("hex")}`), null);
    });
});

test("signatures are domain-separated: a signature over the bare payload is not accepted", () => {
    withSecret(STRONG_SECRET, () => {
        const unseparated = signRaw("user-1", "0", inOneMinute(), STRONG_SECRET, "");

        assert.equal(verifySessionToken(unseparated), null);
        assert.ok(verifySessionToken(signRaw("user-1", "0", inOneMinute(), STRONG_SECRET)));
    });
});

test("malformed or non-canonical versions and expiries fail closed even when correctly signed", () => {
    withSecret(STRONG_SECRET, () => {
        const badVersions = ["-1", "1.5", "abc", "", "01", "00", "+1", "1e3", " 1", "0x1", "2147483648", "99999999999999999999", "٣"];

        for (const version of badVersions) {
            assert.equal(verifySessionToken(signRaw("user-1", version, inOneMinute(), STRONG_SECRET)), null, `version ${JSON.stringify(version)}`);
        }

        for (const expiry of ["", "abc", "-5", "1e12", `0${Date.now() + 60_000}`, "9".repeat(17)]) {
            assert.equal(verifySessionToken(signRaw("user-1", "0", expiry, STRONG_SECRET)), null, `expiry ${JSON.stringify(expiry)}`);
        }
    });
});

test("malformed tokens are rejected", () => {
    withSecret(STRONG_SECRET, () => {
        for (const token of ["", "abc", "a.b", "a.b.c", "a.b.c.d.e", "a.0.1..", ".0.9999999999999.deadbeef", "user-1.0.9999999999999.", "user-1.0.9999999999999.not-hex"]) {
            assert.equal(verifySessionToken(token), null, `expected null for ${JSON.stringify(token)}`);
        }
    });
});

test("session versions 0 and the PostgreSQL INTEGER maximum are accepted, one past it is not", () => {
    withSecret(STRONG_SECRET, () => {
        assert.equal(verifySessionToken(createSessionToken("user-1", 0))?.sessionVersion, 0);
        assert.equal(verifySessionToken(createSessionToken("user-1", MAX_SESSION_VERSION))?.sessionVersion, MAX_SESSION_VERSION);
        assert.throws(() => createSessionToken("user-1", MAX_SESSION_VERSION + 1), /session version/);
    });
});

test("creating a token rejects unsafe versions and user ids without echoing them", () => {
    withSecret(STRONG_SECRET, () => {
        for (const version of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, Number("7") + 0.1]) {
            assert.throws(() => createSessionToken("user-1", version), /session version/);
        }

        for (const userId of ["", "a.b", "..", "user.1"]) {
            assert.throws(
                () => createSessionToken(userId, 0),
                (error: unknown) => error instanceof Error && /user id/.test(error.message) && (userId === "" || !error.message.includes(userId)),
            );
        }
    });
});

test(
    "creating or verifying a token without a secret throws outside development instead of using a known key",
    { skip: process.env.NODE_ENV === "development" },
    () => {
        withSecret(undefined, () => {
            assert.throws(() => createSessionToken("user-1", 0), /Missing BETTER_AUTH_SECRET/);
            assert.throws(() => verifySessionToken(signRaw("user-1", "0", inOneMinute(), DEV_FALLBACK_AUTH_SECRET)), /Missing BETTER_AUTH_SECRET/);
        });
    },
);

test("a token forged with the public dev fallback secret is not accepted with a strong secret configured", () => {
    withSecret(STRONG_SECRET, () => {
        const forged = signRaw("admin-user", "0", inOneMinute(), DEV_FALLBACK_AUTH_SECRET);

        assert.equal(verifySessionToken(forged), null);
    });
});
