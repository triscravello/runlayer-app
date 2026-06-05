import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { getRecommendationHistory } from "@/services/recommendationServerService";

export const runtime = "nodejs";

export const GET = withAuth(async (request: NextRequest, _context, user) => {
    const { searchParams } = new URL(request.url);
    const limitParam = Number(searchParams.get("limit") ?? "20");
    const offsetParam = Number(searchParams.get("offset") ?? "0");
    const history = await getRecommendationHistory(user.id, {
        limit: Number.isFinite(limitParam) ? limitParam : 20,
        offset: Number.isFinite(offsetParam) ? offsetParam : 0,
    });

    return NextResponse.json(history);
})