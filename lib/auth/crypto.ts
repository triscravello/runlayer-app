import { createHmac, timingSafeEqual } from "node:crypto";

function getAuthSecret() {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new Error("Missing BETTER_AUTH_SECRET");
    return secret;
}

export function verifySessionToken(token: string) {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [userId, expiresAtStr, signature] = parts;
    const expiresAt = Number(expiresAtStr);

    if (!userId || !expiresAt || !signature) return null;
    if (Date.now() > expiresAt) return null;

    const payload = `${userId}.${expiresAt}`;

    const expectedSig = createHmac("sha256", getAuthSecret())
        .update(payload)
        .digest("hex");

    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSig);

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return null;
    }

    return { userId };
}