// app/api/recommendation/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { createRecommendation, getRecommendationHistory, type CreateRecommendationInput } from "@/services/recommendationServerService";

export const GET = withAuth(async (_request: NextRequest, _context, user) => {
  const recommendations = await getRecommendationHistory(user.id);
  return NextResponse.json(recommendations);
})

export const POST = withAuth(async (request: NextRequest, _context, user) => {
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