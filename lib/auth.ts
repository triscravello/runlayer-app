import { cookies } from "next/headers";
import { createSessionToken, SESSION_TTL_SECONDS } from "./auth/crypto";
import { hashPassword, verifyPassword } from "./auth/password";
import { createPrismaSessionStore } from "./auth/prismaSessionStore";
import { resolveSessionUser } from "./auth/session";
import { ForbiddenError, UnauthorizedError } from "./http/apiErrors";
import { prisma } from "./prisma";



const AUTH_COOKIE_NAME = "runlayer_session";

export { createSessionToken, hashPassword, verifyPassword };

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

// Prisma-backed store for session resolution and revocation (see lib/auth/session.ts).
export const sessionStore = createPrismaSessionStore(prisma);

export async function getSessionUser() {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

    // Verifies the token and that its session version is still current (i.e. the session was not revoked).
    const user = await resolveSessionUser(token, sessionStore);

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