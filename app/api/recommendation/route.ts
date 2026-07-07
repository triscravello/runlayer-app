// app/api/recommendation/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { recommendationsLimiter, rateLimitHeaders } from "@/lib/rate-limit";
import { createRecommendation, getRecommendationHistory, type CreateRecommendationInput } from "@/services/recommendationServerService";

export const GET = withAuth(async (_request: NextRequest, _context, user) => {
  const { success, limit, remaining, reset } = await recommendationsLimiter.limit(user.id);
  const headers = rateLimitHeaders(limit, remaining, reset);

  if (!success) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        message: "Too many recommendation requests. Please wait.",
        retryAfter: Math.ceil((reset - Date.now()) / 1000),
      },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders(limit, 0, reset),
          "Retry-After": Math.ceil((reset - Date.now()) / 1000).toString(),
        },
      }
    );
  }

  const recommendations = await getRecommendationHistory(user.id);
  return NextResponse.json(recommendations, { headers });
})

export const POST = withAuth(async (request: NextRequest, _context, user) => {
  const { success, limit, remaining, reset } = await recommendationsLimiter.limit(user.id);

  const headers = rateLimitHeaders(limit, remaining, reset);

  if (!success) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        message: "Too many recommendation requests. Please wait.",
        retryAfter: Math.ceil((reset - Date.now()) / 1000),
      },
      { status: 429, headers }
    );
  }

  const body = await request.json();
  const { weatherSnapshotId, inputContext, output, topScore, algorithmVersion, engineVersion, generatedAt } = body;

  if (!inputContext || !output) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const recommendation = await createRecommendation({
    userId: user.id,
    weatherSnapshotId: weatherSnapshotId ?? null,
    inputContext,
    output,
    topScore: topScore ?? null,
    algorithmVersion: algorithmVersion ?? engineVersion ?? null,
    engineVersion: engineVersion ?? algorithmVersion ?? null,
    generatedAt: generatedAt ?? null,
  } as CreateRecommendationInput);

  return NextResponse.json(recommendation);
});