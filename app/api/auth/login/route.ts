import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, getAuthCookies, verifyPassword } from "@/lib/auth";

type UserWithPasswordRow = { id: string; email: string; password_hash: string };

export async function POST(request: Request) {
    try {
        const { email, password } = await request.json();

        if (!email || !password) {
            return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
        }

        if (typeof email !== "string" || typeof password !== "string") {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const users = await prisma.$queryRaw<UserWithPasswordRow[]>`SELECT id, email, password_hash FROM users WHERE email = ${normalizedEmail} LIMIT 1`;

        const user = users[0];

        if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
            return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
        }

        const token = createSessionToken(user.id);
        const { name, options } = getAuthCookies();

        const response = NextResponse.json({
            success: true,
            data: {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    username: user.email,
                },
            },
        });
        response.cookies.set(name, token, options);
        return response;
    } catch (error) {
        console.error("Error logging in:", error);
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "INVALID_CREDENTIALS",
                    message: "Invalid email or password",
                },
            },
            { status: 401 }
        );
    }
}