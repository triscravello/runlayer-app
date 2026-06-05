import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
    const user = await getSessionUser();

    return NextResponse.json({
        authenticated: Boolean(user),
        user: user ? { id: user.id, email: user.email, username: user.email, role: user.role } : undefined,
    })
}