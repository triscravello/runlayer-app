import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { globalLimiter, getClientIp } from "./lib/rate-limit";
import { recordRateLimitHit } from "./lib/instrumentation";
import { verifySessionToken } from "./lib/auth/crypto";

const AUTH_COOKIE_NAME = "runlayer_session";
const protectedPrefixes = ["/dashboard", "/admin"];

// Page gating only checks the token signature and expiry, using the same verifier as the API routes.
// A misconfigured secret fails closed (treated as no session) and is logged.
//
// IMPORTANT: this does NOT establish that a session is still valid. Revocation (logout) is recorded in the
// database as User.sessionVersion, which this check never reads, so a revoked-but-unexpired token still passes
// here. Every protected page and API route re-checks through requireAuth/requireAdmin/getSessionUser
// (lib/auth/session.ts), which is what rejects revoked tokens. Never rely on this proxy alone for authorization.
function hasValidSession(token?: string) {
    if (!token) return false;

    try {
        return verifySessionToken(token) !== null;
    } catch (error) {
        console.error("Session verification unavailable:", error instanceof Error ? error.message : "unknown error");
        return false;
    }
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

  const validSession = hasValidSession(req.cookies.get(AUTH_COOKIE_NAME)?.value);

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