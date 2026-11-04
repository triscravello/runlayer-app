// app/api/weather/route.ts
import { withAuth } from "@/lib/auth/api";
import { recordRateLimitHit } from "@/lib/instrumentation";
import { weatherLimiter } from "@/lib/rate-limit";
import { handleWeatherRequest } from "@/lib/weather/weatherRequest";
import { getWeather } from "@/services/weatherServerService";

// Requires a signed-in user (401 otherwise). The location is validated and normalized, and each user is limited
// to WEATHER_RATE_LIMIT requests per window, before the external weather provider is called.
// See lib/weather/weatherRequest.ts.
export const GET = withAuth(async (request, _context, user) =>
    handleWeatherRequest(request, {
        userId: user.id,
        limiter: weatherLimiter,
        getWeather,
        onRateLimited: () => recordRateLimitHit("/api/weather"),
    }),
);
