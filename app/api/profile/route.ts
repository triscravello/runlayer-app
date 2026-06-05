// app/api/profile/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { getUserProfile, upsertUserProfile, type UpsertUserProfileInput } from "@/services/userServerService";

export const GET = withAuth(async (_request: NextRequest, _context, user) => {
  const profile = await getUserProfile(user.id);

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
});

export const PUT = withAuth(async (request: NextRequest, _context, user) => {
  const body = (await request.json()) as UpsertUserProfileInput;

  const {
    heightCm,
    weightLbs,
    bodyType,
    heatSensitivity,
    heatTolerance,
    coldTolerance,
    chafeProne,
    stylePreference,
    budgetLevel,
    budgetSensitivity,
    preferredFit,
    terrainPreference,
    preferredBrands,
    avoidedBrands,
  } = body;

  const updatedProfile = await upsertUserProfile({
    userId: user.id,
    heightCm,
    weightLbs,
    bodyType,
    heatSensitivity,
    heatTolerance,
    coldTolerance,
    chafeProne,
    stylePreference,
    budgetLevel,
    budgetSensitivity,
    preferredFit,
    terrainPreference,
    preferredBrands,
    avoidedBrands,
  } as UpsertUserProfileInput);

  return NextResponse.json(updatedProfile);
});