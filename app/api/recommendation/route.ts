// app/api/recommendation/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET all recommendations
export async function GET() {
  try {
    const recommendations = await prisma.recommendation.findMany({
      orderBy: {
        createdAt: "desc",
      },
      include: {
        user: true,
        weatherSnapshot: true,
      },
    });

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

    const { userId, weatherSnapshotId, inputContext, output } = body;

    if (!userId || !inputContext || !output) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const recommendation = await prisma.recommendation.create({
      data: {
        userId,
        weatherSnapshotId: weatherSnapshotId ?? null,
        inputContext,
        output,
      },
    });

    return NextResponse.json(recommendation);
  } catch (error) {
    console.error("Error creating recommendation:", error);
    return NextResponse.json(
      { error: "Failed to create recommendation" },
      { status: 500 }
    );
  }
}