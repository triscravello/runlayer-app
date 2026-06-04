import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, getAuthCookies, hashPassword } from "@/lib/auth";

type UserRow = { id: string; email: string };

export async function POST(request: Request) {
    try {
        const { email, password } = await request.json();

        if (!email || !password) {
            return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
        }

        if (typeof email !== "string" || typeof password !== "string") {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        if (password.length < 8) {
            return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const existingUser = await prisma.$queryRaw<UserRow[]>`SELECT id, email FROM users WHERE email = ${normalizedEmail} LIMIT 1`;

        if (existingUser.length > 0) {
            return NextResponse.json({ error: "An account already exists for this email" }, { status: 409 });
        }

        const users = await prisma.$queryRaw<UserRow[]>`INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (${randomUUID()}, ${normalizedEmail}, ${hashPassword(password)}, NOW(), NOW()) RETURNING id, email`;

        const user = users[0];
        if (!user) {
            return NextResponse.json({ error: "Failed to sign up" });
        }

        const token = createSessionToken(user.id);
        const { name, options } = getAuthCookies();

        const response = NextResponse.json(
            {
                success: true,
                data: {
                    token,
                    user: {
                        id: user.id,
                        email: user.email,
                        username: user.email,
                    },
                },
            },
            { status: 201 },
        );

        response.cookies.set(name, token, options);

        return response;
    } catch (error) {
        console.error("Error signing up:", error);
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "VALIDATION_ERROR",
                    message: "Email and password are required", 
                },
            },
            { status: 400 }
        );
    }
}