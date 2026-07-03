import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { withInstrumentation, recordAuthFailure } from "@/lib/instrumentation";

export const GET = withInstrumentation(async (_request: NextRequest) => {
  const user = await getSessionUser();

  if (!user) {
    recordAuthFailure("/api/auth", "no_session");
  }

  return NextResponse.json({
    authenticated: Boolean(user),
    user: user
      ? {
          id: user.id,
          email: user.email,
          username: user.email,
          role: user.role,
          location: user.location,
        }
      : undefined,
  });
}, "/api/auth");