type EnvSource = Readonly<Record<string, string | undefined>>;

// Known, public value. It is only ever accepted when NODE_ENV === "development".
export const DEV_FALLBACK_AUTH_SECRET = "dev-only-secret-change-me";
export const MIN_AUTH_SECRET_LENGTH = 32;

/**
 * Resolves the HMAC secret used to sign session tokens.
 *
 * - NODE_ENV === "development": BETTER_AUTH_SECRET if set, otherwise the public dev fallback.
 * - Any other NODE_ENV (production, test, staging, unset, ...): BETTER_AUTH_SECRET is required,
 *   must be at least MIN_AUTH_SECRET_LENGTH characters, and must not be the dev fallback.
 *
 * Error messages never include the secret value.
 */
export function resolveAuthSecret(env: EnvSource): string {
    const secret = env.BETTER_AUTH_SECRET;

    if (env.NODE_ENV === "development") {
        return secret || DEV_FALLBACK_AUTH_SECRET;
    }

    if (!secret) {
        throw new Error("Missing BETTER_AUTH_SECRET (the development fallback is only available when NODE_ENV=development)");
    }

    if (secret === DEV_FALLBACK_AUTH_SECRET) {
        throw new Error("BETTER_AUTH_SECRET must not be the development fallback value");
    }

    if (secret.length < MIN_AUTH_SECRET_LENGTH) {
        throw new Error(`BETTER_AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters`);
    }

    return secret;
}
