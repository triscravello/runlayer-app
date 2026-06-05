import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { generateGearRecommendations } from "@/services/recommendationServerService";
import type { UserInput } from "@/lib/engine/recommendationEngine";

export const runtime = "nodejs";

export const POST = withAuth(async (request: NextRequest, _context, user) => {
    const body = (await request.json()) as UserInput;
    const recommendations = await generateGearRecommendations({ ...body, userId: user.id }, undefined, user.id);

    return NextResponse.json(recommendations);
})