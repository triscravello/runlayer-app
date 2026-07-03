import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { globalLimiter, getClientIp } from "./lib/rate-limit";
import { recordRateLimitHit } from "./lib/instrumentation";

const AUTH_COOKIE_NAME = "runlayer_session";
const protectedPrefixes = ["/dashboard", "/admin"];

// keep your existing getAuthSecret, hmacSha256Hex, hasValidSession functions here
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

  // Global API rate limiting
  if (path.startsWith("/api/")) {
    const ip = getClientIp(req);
    const { success, limit, remaining, reset } = await globalLimiter.limit(ip);
    const retryAfter = Math.max(0, Math.ceil((reset - Date.now()) / 1000));

    if (!success) {
      recordRateLimitHit(path);
      return NextResponse.json(
        {
          error: "Too many requests",
          message: "You have exceeded the rate limit. Please try again later.",
          retryAfter,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": reset.toString(),
            "Retry-After": retryAfter.toString(),
          },
        }
      );
    }

    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Limit", limit.toString());
    response.headers.set("X-RateLimit-Remaining", remaining.toString());
    response.headers.set("X-RateLimit-Reset", reset.toString());

    return response;
  }

  // Existing page protection
  const isProtectedRoute = protectedPrefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );

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
  matcher: ["/api/:path*", "/dashboard/:path*", "/admin/:path*"],
};