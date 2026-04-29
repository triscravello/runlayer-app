// app/api/profile/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET user profile
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 }
      );
    }

    const profile = await prisma.userProfile.findUnique({
      where: {
        userId,
      },
    });

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(profile);
  } catch (error) {
    console.error("Error fetching user preferences:", error);
    return NextResponse.json(
      { error: "Failed to fetch preferences" },
      { status: 500 }
    );
  }
}

// UPDATE user preferences (UserProfile)
export async function PUT(request: Request) {
  try {
    const body = await request.json();

    const {
      userId,
      heightCm,
      weightLbs,
      bodyType,
      heatSensitivity,
      chafeProne,
      stylePreference,
      budgetLevel,
      preferredFit,
    } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId" },
        { status: 400 }
      );
    }

    const updatedProfile = await prisma.userProfile.upsert({
      where: {
        userId,
      },
      update: {
        heightCm,
        weightLbs,
        bodyType,
        heatSensitivity,
        chafeProne,
        stylePreference,
        budgetLevel,
        preferredFit,
      },
      create: {
        userId,
        heightCm,
        weightLbs,
        bodyType,
        heatSensitivity,
        chafeProne: chafeProne ?? false,
        stylePreference,
        budgetLevel,
        preferredFit,
      },
    });

    return NextResponse.json(updatedProfile);
  } catch (error) {
    console.error("Error updating user preferences:", error);
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 }
    );
  }
}