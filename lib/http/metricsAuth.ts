import { createHash, timingSafeEqual } from "node:crypto";

type EnvSource = Readonly<Record<string, string | undefined>>;

export const MIN_METRICS_TOKEN_LENGTH = 32;
export const MAX_METRICS_TOKEN_LENGTH = 256;

// "Bearer " plus the longest accepted token. Anything longer is rejected before it is hashed.
const MAX_AUTHORIZATION_HEADER_LENGTH = MAX_METRICS_TOKEN_LENGTH + 16;
// RFC 6750 token68 characters.
const TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*$/;

/**
 * Returns an error message when the token is not an acceptable METRICS_TOKEN, otherwise null.
 * The message never contains the token. Generate one with: openssl rand -base64 48
 */
export function validateMetricsToken(token: string): string | null {
    if (
        token.length < MIN_METRICS_TOKEN_LENGTH ||
        token.length > MAX_METRICS_TOKEN_LENGTH ||
        !TOKEN68.test(token)
    ) {
        return `METRICS_TOKEN must be ${MIN_METRICS_TOKEN_LENGTH}-${MAX_METRICS_TOKEN_LENGTH} characters of letters, digits and - . _ ~ + / (optionally ending in =)`;
    }

    return null;
}

export type MetricsAccess =
    | { mode: "open" }
    | { mode: "token"; token: string }
    | { mode: "disabled" };

/**
 * How /api/metrics is exposed:
 * - METRICS_TOKEN set and valid: "token" (bearer authentication required), in every environment.
 * - METRICS_TOKEN unset: "open" ONLY when NODE_ENV is "development" (the local Prometheus/Grafana workflow);
 *   in every other environment (production, staging, test, unset NODE_ENV) the endpoint is "disabled".
 * - METRICS_TOKEN set but invalid: "disabled" in every environment, so a bad value can never expose metrics.
 */
export function resolveMetricsAccess(env: EnvSource): MetricsAccess {
    const token = env.METRICS_TOKEN?.trim();

    if (!token) {
        return env.NODE_ENV === "development" ? { mode: "open" } : { mode: "disabled" };
    }

    return validateMetricsToken(token) === null ? { mode: "token", token } : { mode: "disabled" };
}

/** Constant-time comparison that is safe for inputs of different lengths. */
export function tokensMatch(provided: string, expected: string): boolean {
    const providedDigest = createHash("sha256").update(provided).digest();
    const expectedDigest = createHash("sha256").update(expected).digest();

    return timingSafeEqual(providedDigest, expectedDigest);
}

/** Extracts the token from "Bearer <token>" (scheme case-insensitive, exactly one space). Otherwise null. */
export function parseBearerToken(authorization: string | null): string | null {
    if (!authorization || authorization.length > MAX_AUTHORIZATION_HEADER_LENGTH) return null;

    const match = /^bearer (\S+)$/i.exec(authorization);
    return match ? match[1] : null;
}

export type MetricsAuthDecision = { allowed: true } | { allowed: false; status: 401 | 404 };

/** Decides from the Authorization header and configuration only. The client IP is never consulted. */
export function authorizeMetricsRequest(authorization: string | null, env: EnvSource): MetricsAuthDecision {
    const access = resolveMetricsAccess(env);

    if (access.mode === "open") return { allowed: true };
    // 404 reveals nothing, including whether a token exists, whatever the request carries.
    if (access.mode === "disabled") return { allowed: false, status: 404 };

    const provided = parseBearerToken(authorization);
    if (provided === null || !tokensMatch(provided, access.token)) return { allowed: false, status: 401 };

    return { allowed: true };
}

/**
 * Handles GET /api/metrics. Authorization happens before the registry is touched, and an unauthorized
 * response never contains metrics.
 */
export async function handleMetricsRequest(
    request: Request,
    deps: { env: EnvSource; metrics: () => Promise<string>; contentType: string },
): Promise<Response> {
    const decision = authorizeMetricsRequest(request.headers.get("authorization"), deps.env);

    if (!decision.allowed) {
        if (decision.status === 404) {
            return new Response(null, { status: 404 });
        }

        return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    }

    return new Response(await deps.metrics(), { headers: { "Content-Type": deps.contentType } });
}
