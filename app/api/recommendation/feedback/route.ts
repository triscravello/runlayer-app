import { RecommendationFeedbackType } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { submitRecommendationFeedback } from "@/services/recommendationServerService";

export const runtime = "nodejs";

const validFeedbackTypes = new Set<RecommendationFeedbackType>(["HELPFUL", "NOT_HELPFUL"]);

export const POST = withAuth(async (request: NextRequest, _context, user) => {
    const body = await request.json() as {
        recommendationId?: string;
        feedbackType?: RecommendationFeedbackType;
    }

    if (!body.recommendationId || !body.feedbackType) {
        return NextResponse.json({ error: "Missing recommendationId or feedbackType" }, { status: 400 });
    }

    if (!validFeedbackTypes.has(body.feedbackType)) {
        return NextResponse.json({ error: "Invalid feedbackType" }, { status: 400 });
    }

    const feedback = await submitRecommendationFeedback({
        userId: user.id,
        recommendationId: body.recommendationId,
        feedbackType: body.feedbackType,
    });

    return NextResponse.json({ feedback, status: "recorded" }, { status: 200 });
})