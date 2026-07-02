import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, getAuthCookies, verifyPassword } from "@/lib/auth";
import { authLimiter, getClientIp, rateLimitHeaders } from "@/lib/rate-limit";

type LoginPayload = {
    email?: unknown;
    password?: unknown;
};

function invalidCredentials() {
    return NextResponse.json(
        { success: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } },
        { status: 401 },
    );
}

export async function POST(request: Request) {
    const ip = getClientIp(request);
    const { success, limit, remaining, reset } = await authLimiter.limit(ip);
    const headers = rateLimitHeaders(limit, remaining, reset);

    if (!success) {
        return NextResponse.json(
            {
                error: "Too many login attempts",
                message: "Please wait before trying again.",
                retryAfter: Math.ceil((reset - Date.now()) / 1000),
            },
            {
                status: 429,
                headers: {
                    ...rateLimitHeaders(limit, 0, reset),
                    "Retry-After": Math.ceil((reset - Date.now()) / 1000).toString(),
                },
            }
        );
    }
    try {
        const { email, password } = (await request.json()) as LoginPayload;

        if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
            return NextResponse.json(
                { success: false, error: { code: "VALIDATION_ERROR", message: "Email and password are required" } }, 
                { status: 400, headers },
            );
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: {
                id: true,
                email: true,
                passwordHash: true,
                role: true,
                profile: {
                    select: {
                        location: true,
                    },
                },
            },
        });

        if (!user || !verifyPassword(password, user.passwordHash)) {
            const response = invalidCredentials();
            Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
            return response;
        }

        const token = createSessionToken(user.id);
        const { name, options } = getAuthCookies();
        const response = NextResponse.json(
            {
                success: true,
                data: {
                    user: {
                        id: user.id,
                        email: user.email,
                        username: user.email,
                        role: user.role,
                        location: user.profile?.location ?? null,
                    },
                },
            },
            { headers }
        );

        response.cookies.set(name, token, options);
        return response;
    } catch (error) {
        console.error("Error logging in:", error);
        return invalidCredentials();
    }
}