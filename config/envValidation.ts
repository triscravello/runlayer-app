import { resolveAuthSecret } from "../lib/auth/secret";
import { parseClientIpStrategy } from "../lib/http/clientIp";
import { validateMetricsToken } from "../lib/http/metricsAuth";
import { resolveRateLimitConfig } from "../lib/rateLimit/config";

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Returns a list of configuration problems for the given environment (empty when valid).
 * Pure: reads only the object it is given and never includes secret values in messages.
 *
 * Covers the auth secret, required variables, the rate-limit backend, the client-IP strategy and the
 * metrics token.
 */
export function validateEnv(env: EnvSource): string[] {
    const problems: string[] = [];

    try {
        resolveAuthSecret(env);
    } catch (error) {
        problems.push(error instanceof Error ? error.message : "Invalid BETTER_AUTH_SECRET");
    }

    if (!env.DATABASE_URL?.trim()) {
        problems.push("Missing DATABASE_URL");
    }

    if (env.NODE_ENV !== "development" && !env.WEATHER_API_KEY?.trim()) {
        problems.push("Missing WEATHER_API_KEY");
    }

    const rateLimit = resolveRateLimitConfig(env);
    if (!rateLimit.ok) {
        problems.push(rateLimit.error);
    }

    const clientIp = parseClientIpStrategy(env.CLIENT_IP_STRATEGY, env.NODE_ENV);
    if (!clientIp.ok) {
        problems.push(clientIp.error);
    }

    // METRICS_TOKEN is optional (an unset token disables /api/metrics outside development), but a value that is
    // set must be valid; an invalid one also disables the endpoint, so report it instead of failing silently.
    const metricsToken = env.METRICS_TOKEN?.trim();
    if (metricsToken) {
        const metricsProblem = validateMetricsToken(metricsToken);
        if (metricsProblem) {
            problems.push(metricsProblem);
        }
    }

    return problems;
}
