import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveAuthSecret } from "./secret";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

// Mixed into every signature so these tokens can never validate as, or be confused with, any other format
// (including the earlier three-part "userId.expiresAt.signature" tokens, which are rejected outright).
const TOKEN_DOMAIN = "session-v2:";

/** Largest value of the PostgreSQL INTEGER column that stores the session version. */
export const MAX_SESSION_VERSION = 2_147_483_647;

const DIGITS = /^\d{1,16}$/;

function getAuthSecret() {
    return resolveAuthSecret(process.env);
}

function signSessionPayload(payload: string) {
    return createHmac("sha256", getAuthSecret()).update(`${TOKEN_DOMAIN}${payload}`).digest("hex");
}

function isValidSessionVersion(value: number) {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SESSION_VERSION;
}

/**
 * Creates a signed session token: `userId.sessionVersion.expiresAt.signature`.
 * The token is valid only while the user's stored sessionVersion still equals the version it carries.
 */
export function createSessionToken(userId: string, sessionVersion: number) {
    // The format is dot-delimited, so an id containing a dot would make the token ambiguous.
    if (!userId || userId.includes(".")) {
        throw new Error("Cannot create a session token for this user id");
    }

    if (!isValidSessionVersion(sessionVersion)) {
        throw new Error("Cannot create a session token with this session version");
    }

    const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
    const payload = `${userId}.${sessionVersion}.${expiresAt}`;
    const signature = signSessionPayload(payload);

    return `${payload}.${signature}`;
}

/**
 * Verifies the signature and expiry and returns the claims, or null. Anything malformed fails closed.
 * This proves the token was issued by this server; it does NOT prove it has not been revoked. Revocation is
 * checked against the database by resolveSessionUser (lib/auth/session.ts).
 */
export function verifySessionToken(token: string) {
    const parts = token.split(".");
    if (parts.length !== 4) return null;

    const [userId, versionStr, expiresAtStr, signature] = parts;

    if (!userId || !signature) return null;
    if (!DIGITS.test(versionStr) || !DIGITS.test(expiresAtStr)) return null;

    const sessionVersion = Number(versionStr);
    const expiresAt = Number(expiresAtStr);

    if (!isValidSessionVersion(sessionVersion) || !Number.isSafeInteger(expiresAt)) return null;
    // Canonical decimal form only (no leading zeros), so one set of claims has exactly one signed encoding.
    if (String(sessionVersion) !== versionStr || String(expiresAt) !== expiresAtStr) return null;
    if (Date.now() > expiresAt) return null;

    const expectedSig = signSessionPayload(`${userId}.${versionStr}.${expiresAtStr}`);

    const actualSignature = Buffer.from(signature, "hex");
    const expectedSignature = Buffer.from(expectedSig, "hex");

    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
        return null;
    }

    return { userId, sessionVersion, expiresAt };
}

export { SESSION_TTL_SECONDS };
