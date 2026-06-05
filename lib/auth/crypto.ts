import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function getAuthSecret() {
    const secret = process.env.BETTER_AUTH_SECRET;
    
    if (secret) {
        return secret;
    }

    if (process.env.NODE_ENV === "production") {
        throw new Error("Missing BETTER_AUTH_SECRET");
    }

    return "dev-only-secret-change-me";
}

function signSessionPayload(payload: string) {
    return createHmac("sha256", getAuthSecret()).update(payload).digest("hex");
}

export function createSessionToken(userId: string) {
    const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
    const payload = `${userId}.${expiresAt}`;
    const signature = signSessionPayload(payload);

    return `${payload}.${signature}`;
}

export function verifySessionToken(token: string) {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [userId, expiresAtStr, signature] = parts;
    const expiresAt = Number(expiresAtStr);

    if (!userId || !Number.isFinite(expiresAt) || !signature) return null;
    if (Date.now() > expiresAt) return null;

    const payload = `${userId}.${expiresAt}`;
    const expectedSig = signSessionPayload(payload);

    const actualSignature = Buffer.from(signature, "hex");
    const expectedSignature = Buffer.from(expectedSig, "hex");

    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
        return null;
    }

    return { userId, expiresAt };
}

export { SESSION_TTL_SECONDS };