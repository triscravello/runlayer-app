import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, getAuthCookies, verifyPassword } from "@/lib/auth";
import { authLimiters, getClientIp, getEmailRateLimitKey, rateLimitHeaders } from "@/lib/rate-limit";
import { buildRateLimitedResponse, checkEmailLimit, checkNetworkLimits, mostRestrictive } from "@/lib/rateLimit/authThrottle";
import type { RateLimitResult } from "@/lib/rateLimit/createRateLimiter";
import { withInstrumentation, recordAuthFailure, recordRateLimitHit } from "@/lib/instrumentation";

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

// One response for every throttling layer (global, IP, account), so it never reveals which one triggered.
function tooManyLoginAttempts(result: RateLimitResult) {
    recordRateLimitHit("/api/auth/login");
    const { status, body, headers } = buildRateLimitedResponse(result, Date.now(), {
        error: "Too many login attempts",
        message: "Please wait before trying again.",
    });

    return NextResponse.json(body, { status, headers });
}

export const POST = withInstrumentation(async (request: NextRequest) => {
    // Layers 1 and 2 run before the body is read: the shared flood guard, then the per-IP limiter when a
    // trusted client IP exists (skipped for CLIENT_IP_STRATEGY=none).
    const network = await checkNetworkLimits(
        { flood: authLimiters.loginFlood, ip: authLimiters.loginIp },
        getClientIp(request),
    );

    if (!network.allowed) {
        return tooManyLoginAttempts(network.result);
    }

    let headers = rateLimitHeaders(network.result.limit, network.result.remaining, network.result.reset);

    try {
        const { email, password } = (await request.json()) as LoginPayload;

        if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
            recordAuthFailure("/api/auth/login", "validation_error");
            return NextResponse.json(
                { success: false, error: { code: "VALIDATION_ERROR", message: "Email and password are required" } }, 
                { status: 400, headers },
            );
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Layer 3: per-account limit on the hashed email, applied identically whether or not the account
        // exists, and before the database lookup and password hashing.
        const account = await checkEmailLimit(authLimiters.loginEmail, getEmailRateLimitKey(normalizedEmail));

        if (!account.allowed) {
            return tooManyLoginAttempts(account.result);
        }

        const decisive = mostRestrictive(network.result, account.result);
        headers = rateLimitHeaders(decisive.limit, decisive.remaining, decisive.reset);

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
            recordAuthFailure("/api/auth/login", "invalid_credentials");
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
        recordAuthFailure("/api/auth/login", "login_error");
        console.error("Error logging in:", error);
        return invalidCredentials();
    }
}, "/api/auth/login");