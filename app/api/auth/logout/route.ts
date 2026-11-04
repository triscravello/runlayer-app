import type { NextRequest } from "next/server";

import { getAuthCookies, sessionStore } from "@/lib/auth";
import { describeErrorForLog, handleLogout } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

// Revokes the caller's server-side session (every session of this user: "log out everywhere") and clears the
// cookie. A stale or invalid cookie changes nothing on the server. If revocation fails the cookie is still
// cleared but the response is HTTP 500. See lib/auth/session.ts.
export async function POST(request: NextRequest) {
    const { name } = getAuthCookies();

    return handleLogout(request.cookies.get(name)?.value, {
        store: sessionStore,
        cookieName: name,
        secure: process.env.NODE_ENV === "production",
        // Only the error type is logged: database error messages can contain user identifiers.
        onError: (error) => logger.error("Session revocation failed", { error: describeErrorForLog(error) }),
    });
}
