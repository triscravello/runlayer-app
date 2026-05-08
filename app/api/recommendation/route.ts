// app/api/recommendation/route.ts
import { NextResponse } from "next/server";
import { createRecommendation, CreateRecommendationInput, listRecommendations } from "@/services/recommendationService";

// GET all recommendations
export async function GET() {
  try {
    const recommendations = await listRecommendations();

    return NextResponse.json(recommendations);
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    return NextResponse.json(
      { error: "Failed to fetch recommendations" },
      { status: 500 }
    );
  }
}

// CREATE recommendation
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { userId, weatherSnapshotId, inputContext, output, topScore, algorithmVersion } = body;

    if (!userId || !inputContext || !output) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const recommendation = await createRecommendation({
      userId,
      weatherSnapshotId: weatherSnapshotId ?? null,
      inputContext,
      output,
      topScore: topScore ?? null,
      algorithmVersion: algorithmVersion ?? null,
    } as CreateRecommendationInput);

    return NextResponse.json(recommendation);
  } catch (error) {
    console.error("Error creating recommendation:", error);
    return NextResponse.json(
      { error: "Failed to create recommendation" },
      { status: 500 }
    );
  }
}