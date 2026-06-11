import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE_NAME = "runlayer_session";
const protectedPrefixes = ["/dashboard", "/admin"];

function getAuthSecret() {
    const secret = process.env.BETTER_AUTH_SECRET;

    if (secret) return secret;
    if (process.env.NODE_ENV === "production") return null;
    return "dev-only-secret-change-me";
}

async function hmacSha256Hex(payload: string, secret: string) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hasValidSession(token?: string) {
    if (!token) return false;

    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const [userId, expiresAtStr, signature] = parts;
    const expiresAt = Number(expiresAtStr);
    const secret = getAuthSecret();

    if (!secret || !userId || !Number.isFinite(expiresAt) || !signature) return false;
    if (Date.now() > expiresAt) return false;

    const expected = await hmacSha256Hex(`${userId}.${expiresAt}`, secret);
    return signature === expected;
}

export async function proxy(req: NextRequest) {
    const path = req.nextUrl.pathname;
    const isProtectedRoute = protectedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

    if (!isProtectedRoute) {
        return NextResponse.next();
    }

    const validSession = await hasValidSession(req.cookies.get(AUTH_COOKIE_NAME)?.value);

    if (!validSession) {
        const loginUrl = new URL("/login", req.url);
        loginUrl.searchParams.set("redirect", `${req.nextUrl.pathname}${req.nextUrl.search}`);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/dashboard/:path*", "/admin/:path*"],
}