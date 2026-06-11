import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, getAuthCookies, verifyPassword } from "@/lib/auth";

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
    try {
        const { email, password } = (await request.json()) as LoginPayload;

        if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
            return NextResponse.json(
                { success: false, error: { code: "VALIDATION_ERROR", message: "Email and password are required" } }, 
                { status: 400 },
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
            return invalidCredentials();
        }

        const token = createSessionToken(user.id);
        const { name, options } = getAuthCookies();
        const response = NextResponse.json({
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
        });

        response.cookies.set(name, token, options);
        return response;
    } catch (error) {
        console.error("Error logging in:", error);
        return invalidCredentials();
    }
}