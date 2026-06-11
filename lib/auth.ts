import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { verifySessionToken, createSessionToken, SESSION_TTL_SECONDS } from "./auth/crypto";
import { ForbiddenError, UnauthorizedError } from "./http/apiErrors";
import { prisma } from "./prisma";



const AUTH_COOKIE_NAME = "runlayer_session";

export { createSessionToken };

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

export type SessionUser = Awaited<ReturnType<typeof getSessionUser>> extends infer User ? NonNullable<User> : never;

export async function getSessionUser() {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    if (!token) return null;

    const session = verifySessionToken(token);
    if (!session) return null;

    const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: {
            id: true,
            email: true,
            role: true,
            createdAt: true,
            updatedAt: true,
            profile: {
                select: {
                    location: true,
                },
            },
        },
    });

    if (!user) return null;

    return {
        id: user.id,
        email: user.email, 
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt, 
        location: user.profile?.location ?? null,
    };
}

export async function requireAuth() {
    const user = await getSessionUser();

    if (!user) {
        throw new UnauthorizedError();
    }

    return user;
}

export async function requireRole(role: "ADMIN" | "USER") {
    const user = await requireAuth();

    if (user.role !== role) {
        throw new ForbiddenError();
    }

    return user;
}

export const requireAdmin = () => requireRole("ADMIN");