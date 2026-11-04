import { z } from "zod";
import { BadRequestError, errorResponse } from "../http/apiErrors";
import { buildRateLimitedResponse } from "../rateLimit/authThrottle";
import { rateLimitHeaders } from "../rateLimit/headers";
import { createRateLimiter, type RateLimiterDeps, type SafeRateLimiter } from "../rateLimit/createRateLimiter";

/** Per-user starting value for weather lookups. Adjust here. */
export const WEATHER_RATE_LIMIT = { limit: 30, windowSeconds: 60 } as const;

/**
 * Weather lookups spend the shared provider quota, so the limiter uses the "memory-fallback" policy: if the
 * distributed backend errors, a bounded process-local limiter still enforces the same per-user limit.
 *
 * Trade-off: "fail-open" would let an outage remove all protection of the provider quota; "fail-closed" would
 * turn off weather for every user during an outage. The fallback keeps weather available while keeping the
 * limit, but it is per process, so with several instances the effective limit during an outage is up to
 * (limit x instances) per user.
 */
export function createWeatherLimiter(deps: RateLimiterDeps): SafeRateLimiter {
    return createRateLimiter(
        {
            name: "weather",
            prefix: "runlayer:weather",
            limit: WEATHER_RATE_LIMIT.limit,
            windowSeconds: WEATHER_RATE_LIMIT.windowSeconds,
            algorithm: "sliding",
            failurePolicy: "memory-fallback",
        },
        deps,
    );
}

// --- location validation ---------------------------------------------------

export const MAX_WEATHER_LOCATION_LENGTH = 120;
// Upper bound on the raw value, checked before any processing so oversized input is rejected cheaply.
const MAX_RAW_LOCATION_LENGTH = 512;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
// Letters (any script), combining marks, digits, space, comma, period, apostrophes, hyphen, parentheses.
const ALLOWED_CHARACTERS = /^[\p{L}\p{M}\p{N} ,.'’()-]+$/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Canonical form used for the provider request: NFC, single spaces, ", " after commas, trimmed. */
export function normalizeWeatherLocation(raw: string): string {
    return raw
        .normalize("NFC")
        .replace(/\s+/g, " ")
        .replace(/ ?, ?/g, ", ")
        .trim()
        .replace(/^,\s*|,\s*$/g, "")
        .trim();
}

const INVALID_CHARACTERS = "Location contains invalid characters";

export const weatherLocationSchema = z
    .string({ error: "Missing location" })
    .max(MAX_RAW_LOCATION_LENGTH, "Location is too long")
    .refine((value) => !CONTROL_CHARACTERS.test(value), INVALID_CHARACTERS)
    .transform(normalizeWeatherLocation)
    .pipe(
        z
            .string()
            .min(1, "Missing location")
            .max(MAX_WEATHER_LOCATION_LENGTH, "Location is too long")
            .regex(ALLOWED_CHARACTERS, INVALID_CHARACTERS)
            .regex(HAS_LETTER_OR_DIGIT, INVALID_CHARACTERS),
    );

/**
 * Validates and normalizes the `location` query value. Throws BadRequestError (400) with a fixed message that
 * never echoes the input.
 */
export function parseWeatherLocation(raw: string | null): string {
    const result = weatherLocationSchema.safeParse(raw);

    if (!result.success) {
        throw new BadRequestError(result.error.issues[0]?.message ?? "Invalid location");
    }

    return result.data;
}

// --- request handling ------------------------------------------------------

export type WeatherRequestDeps = {
    /** The authenticated user's id (from the session, never from the request). It is the rate-limit key. */
    userId: string;
    limiter: SafeRateLimiter;
    getWeather: (location: string) => Promise<unknown>;
    onRateLimited?: () => void;
    now?: () => number;
};

/**
 * Handles GET /api/weather for an already-authenticated user.
 * Order: validate the location, apply the per-user limit, then (and only then) call the provider.
 * Rejected requests never reach the provider. Errors keep the existing { error, code } convention.
 */
export async function handleWeatherRequest(request: Request, deps: WeatherRequestDeps): Promise<Response> {
    try {
        const location = parseWeatherLocation(new URL(request.url).searchParams.get("location"));

        const decision = await deps.limiter.limit(deps.userId);

        if (!decision.success) {
            deps.onRateLimited?.();
            const { status, body, headers } = buildRateLimitedResponse(decision, (deps.now ?? Date.now)(), {
                error: "Too many weather requests",
                message: "Please wait before trying again.",
            });

            return Response.json(body, { status, headers });
        }

        const weather = await deps.getWeather(location);

        return Response.json(weather, { headers: rateLimitHeaders(decision.limit, decision.remaining, decision.reset) });
    } catch (error) {
        return errorResponse(error, "Failed to fetch weather");
    }
}
