import { NextResponse } from "next/server";
import { verifySessionToken } from "./crypto";

/**
 * Session revocation.
 *
 * A session token carries the user's sessionVersion at issue time and is valid only while it still equals the
 * stored value. Logging out increments the stored value, which ends every session issued for that user
 * ("log out everywhere"); a token with an older version can never be used again.
 */

export type SessionStore<TUser extends { sessionVersion: number }> = {
    findUserById(id: string): Promise<TUser | null>;
    /**
     * Atomically increments the user's sessionVersion by one if, and only if, it currently equals
     * `expectedVersion` (a single compare-and-increment, e.g. UPDATE ... WHERE id = ? AND session_version = ?).
     * Resolves to true when exactly one row was updated.
     */
    incrementSessionVersionIfCurrent(id: string, expectedVersion: number): Promise<boolean>;
};

/**
 * Returns the user a token belongs to, or null. The token must verify (signature, expiry, format) AND carry the
 * user's current sessionVersion. Equality is required, so neither an older nor a forged-ahead version passes.
 * Role and other fields come from the store on every call, so changes take effect without a new login.
 */
export async function resolveSessionUser<TUser extends { sessionVersion: number }>(
    token: string | undefined,
    store: SessionStore<TUser>,
): Promise<TUser | null> {
    if (!token) return null;

    const session = verifySessionToken(token);
    if (!session) return null;

    const user = await store.findUserById(session.userId);
    if (!user || user.sessionVersion !== session.sessionVersion) return null;

    return user;
}

export type RevocationOutcome =
    /** The token was current; the user's sessions are now revoked. */
    | "revoked"
    /** The token was valid but already out of date (another logout won, or it was revoked earlier). Nothing changed. */
    | "stale"
    /** No token, or one that does not verify. The store was not touched. */
    | "no_session";

/**
 * Revokes the sessions the token belongs to. Idempotent and race-safe: the increment only applies if the stored
 * version still equals the token's, so concurrent calls with one token increment at most once, and a stale
 * token can never revoke sessions issued after it. Throws if the store fails.
 */
export async function revokeSession<TUser extends { sessionVersion: number }>(
    token: string | undefined,
    store: SessionStore<TUser>,
): Promise<RevocationOutcome> {
    if (!token) return "no_session";

    const session = verifySessionToken(token);
    if (!session) return "no_session";

    const updated = await store.incrementSessionVersionIfCurrent(session.userId, session.sessionVersion);
    return updated ? "revoked" : "stale";
}

/**
 * A log-safe description of an error: its name and, for database errors, its code. Messages are deliberately
 * excluded because database error messages can contain query arguments such as user identifiers.
 */
export function describeErrorForLog(error: unknown): string {
    if (!(error instanceof Error)) return "UnknownError";

    const code = (error as { code?: unknown }).code;
    return typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? `${error.name}:${code}` : error.name;
}

/**
 * Handles POST /api/auth/logout. The browser cookie is ALWAYS cleared (with the same attributes as before). If
 * revoking the server-side session fails, the response is HTTP 500 and does not claim success.
 */
export async function handleLogout<TUser extends { sessionVersion: number }>(
    token: string | undefined,
    deps: {
        store: SessionStore<TUser>;
        cookieName: string;
        secure: boolean;
        onError?: (error: unknown) => void;
    },
): Promise<NextResponse> {
    let failed = false;

    try {
        await revokeSession(token, deps.store);
    } catch (error) {
        failed = true;
        deps.onError?.(error);
    }

    const response = failed
        ? NextResponse.json(
            { success: false, error: { code: "LOGOUT_FAILED", message: "Unable to end the session. Please try again." } },
            { status: 500 },
        )
        : NextResponse.json({ success: true, redirectTo: "/login" });

    response.cookies.set(deps.cookieName, "", {
        httpOnly: true,
        secure: deps.secure,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
    });

    return response;
}
