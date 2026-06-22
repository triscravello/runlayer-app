import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { deleteRecommendationHistory } from "@/services/recommendationServerService";

type RecommendationHistoryRouteContext = {
    params: Promise<{ id: string }>;
};

export const runtime = "nodejs";

export const DELETE = withAuth<RecommendationHistoryRouteContext>(async (_request: NextRequest, { params }, user) => {
    const { id } = await params;
    const result = await deleteRecommendationHistory(user.id, id);

    if (result.count === 0) {
        return NextResponse.json({ error: "Recommendation history record not found" }, { status: 404 });
    }

    return NextResponse.json({ deletedCount: result.count });
});