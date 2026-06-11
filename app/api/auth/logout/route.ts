import { NextResponse } from "next/server";

import { getAuthCookies } from "@/lib/auth";

export async function POST() {
    const { name } = getAuthCookies();
    const response = NextResponse.json({ success: true, redirectTo: "/login" });

    response.cookies.set(name, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
    });

    return response;
}