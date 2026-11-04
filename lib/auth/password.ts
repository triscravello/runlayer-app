// Pure password hashing (node:crypto only), shared by the application and the seed scripts. This file must stay
// free of framework imports and path aliases: the seed scripts run under `node --experimental-strip-types`.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

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
