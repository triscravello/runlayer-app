import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, getAuthCookies, hashPassword } from "@/lib/auth";

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

export async function POST(request: Request) {
    try {
        const { email, password, location } = (await request.json()) as SignupPayload;

        if (typeof email !== "string" || typeof password !== "string") {
            return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Email and password are required" } }, { status: 400 });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (!emailPattern.test(normalizedEmail)) {
            return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Enter a valid email address" } }, { status: 400 });
        }

        if (password.length < 8) {
            return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Password must have be at least 8 characters " } }, { status: 400 });
        }

        if (typeof location !== "string" || !location.trim()) {
            return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Location is required" } }, { status: 400 });
        }

        const normalizedLocation = location.trim();

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
                profile: {
                    select: {
                        location: true,
                    },
                },
            },
        });

        const token = createSessionToken(user.id);
        const { name, options } = getAuthCookies();
        const response = NextResponse.json(
            {
                success: true,
                data: {
                    user: authUserResponse({ ...user, location: user.profile?.location ?? null }),
                },
            },
            { status: 201 },
        );

        response.cookies.set(name, token, options);
        return response;
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return NextResponse.json(
                { success: false, error: { code: "DUPLICATE_EMAIL", message: "An account already exists for this email" } },
                { status: 409 },
            );
        }

        console.error("Error signing up:", error);
        return NextResponse.json(
            { success: false, error: { code: "SIGNUP_FAILED", message: "Unable to create account" } },
            { status: 500 },
        );
    }
}