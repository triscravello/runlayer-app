import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const AUTH_COOKIE_NAME = "runlayer_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function getAuthSecret() {
    return process.env.BETTER_AUTH_SECRET || "dev-only-secret-change-me";
}

export function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
    const [salt, key] = stored.split(":");
    if (!salt || !key) return false;

    const derivedKey = scryptSync(password, salt, 64);
    const originalKey = Buffer.from(key, "hex");

    if (derivedKey.length !== originalKey.length) return false;
    return timingSafeEqual(derivedKey, originalKey);
}

export function createSessionToken(userId: string) {
    const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
    const payload = `${userId}.${expiresAt}`;
    const signature = createHmac("sha256", getAuthSecret()).update(payload).digest("hex");

    return `${payload}.${signature}`;
}

export function getAuthCookies() {
    return {
        name: AUTH_COOKIE_NAME,
        options: {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax" as const,
            path: "/",
            maxAge: SESSION_TTL_SECONDS,
        }
    };
}