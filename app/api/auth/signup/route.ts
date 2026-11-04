import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, getAuthCookies, hashPassword } from "@/lib/auth";
import { authLimiters, getClientIp, getEmailRateLimitKey, rateLimitHeaders } from "@/lib/rate-limit";
import { buildRateLimitedResponse, checkEmailLimit, checkNetworkLimits, mostRestrictive } from "@/lib/rateLimit/authThrottle";
import { describeErrorForLog } from "@/lib/auth/session";
import type { RateLimitResult } from "@/lib/rateLimit/createRateLimiter";
import { recordRateLimitHit } from "@/lib/instrumentation";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SignupPayload = {
    email?: unknown;
    password?: unknown;
    location?: unknown;
};

function authUserResponse(user: { id: string; email: string; role: string; location: string | null }) {
    return {
        id: user.id,
        email: user.email,
        username: user.email,
        role: user.role,
        location: user.location,
    }
}

// One response for every throttling layer (global, IP, account), so it never reveals which one triggered.
function tooManySignupAttempts(result: RateLimitResult) {
    recordRateLimitHit("/api/auth/signup");
    const { status, body, headers } = buildRateLimitedResponse(result, Date.now(), {
        error: "Too many sign-up attempts",
        message: "Please wait before trying again.",
    });

    return NextResponse.json(body, { status, headers });
}

export async function POST(request: Request) {
    let headers: Record<string, string> = {};

    try {
        // Layers 1 and 2 run before the body is read: the shared flood guard, then the per-IP limiter when a
        // trusted client IP exists (skipped for CLIENT_IP_STRATEGY=none).
        const network = await checkNetworkLimits(
            { flood: authLimiters.signupFlood, ip: authLimiters.signupIp },
            getClientIp(request),
        );

        if (!network.allowed) {
            return tooManySignupAttempts(network.result);
        }

        headers = rateLimitHeaders(network.result.limit, network.result.remaining, network.result.reset);

        const { email, password, location } = (await request.json()) as SignupPayload;

        if (typeof email !== "string" || typeof password !== "string") {
            return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Email and password are required" } }, { status: 400, headers });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (!emailPattern.test(normalizedEmail)) {
            return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Enter a valid email address" } }, { status: 400, headers });
        }

        if (password.length < 8) {
            return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Password must have be at least 8 characters " } }, { status: 400, headers });
        }

        if (typeof location !== "string" || !location.trim()) {
            return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Location is required" } }, { status: 400, headers });
        }

        const normalizedLocation = location.trim();

        // Layer 3: per-account limit on the hashed email, applied before password hashing and account
        // creation, identically whether or not the address is already registered.
        const account = await checkEmailLimit(authLimiters.signupEmail, getEmailRateLimitKey(normalizedEmail));

        if (!account.allowed) {
            return tooManySignupAttempts(account.result);
        }

        const decisive = mostRestrictive(network.result, account.result);
        headers = rateLimitHeaders(decisive.limit, decisive.remaining, decisive.reset);

        const user = await prisma.user.create({
            data: {
                email: normalizedEmail,
                passwordHash: hashPassword(password),
                profile: {
                    create: {
                        location: normalizedLocation,
                    },
                },
            },
            select: {
                id: true,
                email: true,
                role: true,
                sessionVersion: true,
                profile: {
                    select: {
                        location: true,
                    },
                },
            },
        });

        const token = createSessionToken(user.id, user.sessionVersion);
        const { name, options } = getAuthCookies();
        const response = NextResponse.json(
            {
                success: true,
                data: {
                    user: authUserResponse({ ...user, location: user.profile?.location ?? null }),
                },
            },
            { status: 201, headers },
        );

        response.cookies.set(name, token, options);
        return response;
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return NextResponse.json(
                { success: false, error: { code: "DUPLICATE_EMAIL", message: "An account already exists for this email" } },
                { status: 409, headers },
            );
        }

        // Log only the error type: database error messages can contain query arguments such as the email address.
        console.error("Error signing up:", describeErrorForLog(error));
        return NextResponse.json(
            { success: false, error: { code: "SIGNUP_FAILED", message: "Unable to create account" } },
            { status: 500, headers },
        );
    }
}
