import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { verifySessionToken } from "./auth/crypto";
import { prisma } from "./prisma";



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

export async function getSessionUser() {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    if (!token) return null;

    const session = verifySessionToken(token);
    if (!session) return null;

    return prisma.user.findUnique({
        where: { id: session.userId },
        select: {
            id: true,
            email: true,
            role: true,
            createdAt: true,
            updatedAt: true,
        },
    })
}

export async function requireAuth() {
    const user = await getSessionUser();

    if (!user) {
        throw new Error("Unauthorized");
    }

    return user;
}

export async function requireRole(role: "ADMIN" | "USER") {
    const user = await requireAuth();

    if (user.role !== role) {
        throw new Error("Forbidden");
    }

    return user;
}

export const requireAdmin = () => requireRole("ADMIN");