// app/api/profile/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { getUserProfile, upsertUserProfile } from "@/services/userServerService";
import { profileSchema } from "@/lib/validation/profileSchema";

export const GET = withAuth(async (_request: NextRequest, _context, user) => {
  const profile = await getUserProfile(user.id);

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
});

export const PUT = withAuth(async (request: NextRequest, _context, user) => {
  const body: unknown = await request.json();
  const result = profileSchema.safeParse(body);

  if (!result.success) {
    return NextResponse.json(
      {
        error: "Profile validation failed.",
        validationErrors: result.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const updatedProfile = await upsertUserProfile({
    userId: user.id,
    ...result.data,
  });

  return NextResponse.json(updatedProfile);
});