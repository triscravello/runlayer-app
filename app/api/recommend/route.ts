import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/auth/api";
import { generateGearRecommendations } from "@/services/recommendationServerService";
import { parseJsonBody } from "@/lib/http/validation";
import type { UserInput } from "@/lib/engine/recommendationEngine";
import { recommendationsLimiter, rateLimitHeaders } from "@/lib/rate-limit";
import { withInstrumentation, recordRecommendation, recordRateLimitHit } from "@/lib/instrumentation";
import { redis } from "@/lib/redis";
import crypto from "crypto";

export const runtime = "nodejs";

const weatherSnapshotSchema = z.object({
    location: z.string().optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    tempF: z.number().optional().nullable(),
    feelsLikeF: z.number().optional().nullable(),
    humidity: z.number().optional().nullable(),
    windSpeed: z.number().optional().nullable(),
    precipitationChance: z.number().optional().nullable(),
    uvIndex: z.number().optional().nullable(),
    condition: z.string().optional().nullable(),
    tempCategory: z.string().optional().nullable(),
});

const recommendationInputSchema = z.object({
    userId: z.string().optional(),
    weather: z.enum(["hot", "warm", "cold", "rain", "humid", "wind"]).optional(),
    weatherSnapshot: weatherSnapshotSchema.optional().nullable(),
    intensity: z.enum(["recovery", "easy", "long-run", "tempo", "intervals", "race"]).optional(),
    workoutType: z.string().optional(),
    terrain: z.enum(["road", "trail", "treadmill"]).optional(),
    category: z.enum(["top", "bottom", "accessory", "outerwear", "socks", "hat", "gloves", "all"]).optional(),
})

export const POST = withInstrumentation(
  withAuth(async (request: NextRequest, _context, user) => {
    const { success, limit, remaining, reset } =
      await recommendationsLimiter.limit(user.id);

    const headers = rateLimitHeaders(limit, remaining, reset);
    const retryAfter = Math.max(0, Math.ceil((reset - Date.now()) / 1000));

    if (!success) {
      recordRateLimitHit("/api/recommend");

      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          message: "Too many recommendation requests. Please wait.",
          retryAfter,
        },
        {
          status: 429,
          headers: {
            ...rateLimitHeaders(limit, 0, reset),
            "Retry-After": retryAfter.toString(),
          },
        }
      );
    }

    const body = await parseJsonBody<UserInput>(
      request,
      recommendationInputSchema
    );

    const cacheKey = crypto.createHash("sha256").update(JSON.stringify({ userId: user.id, body })).digest("hex");

    const redisKey = `recommendation:${cacheKey}`;

    const cached = await redis.get(redisKey);

    if (cached) {
      return NextResponse.json(JSON.parse(cached), { headers });
    }

    const recommendations = await generateGearRecommendations(
      { ...body, userId: user.id },
      undefined,
      user.id
    );

    await redis.set(redisKey, JSON.stringify(recommendations), "EX", 60);

    recordRecommendation();

    return NextResponse.json(recommendations, { headers });
  }),
  "/api/recommend"
);