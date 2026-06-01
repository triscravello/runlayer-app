import { RecommendationFeedbackType } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { submitRecommendationFeedback } from "@/services/recommendationServerService";

export const runtime = "nodejs";

const validFeedbackTypes = new Set<RecommendationFeedbackType>(["HELPFUL", "NOT_HELPFUL"]);

export async function POST(request: Request) {
    try {
        const body = await request.json() as {
            userId?: string;
            recommendationId?: string;
            feedbackType: RecommendationFeedbackType;
        };
        const sessionUser = await getSessionUser();
        const userId = sessionUser?.id ?? body.userId;

        if (!userId || !body.recommendationId || !body.feedbackType) {
            return NextResponse.json({ error: "Missing userId, recommendationId, or feedbackType" }, { status: 400 });
        }

        if (!validFeedbackTypes.has(body.feedbackType)) {
            return NextResponse.json({ error: "Invalid feedbackType" }, { status: 400 });
        }

        const feedback = await submitRecommendationFeedback({
            userId,
            recommendationId: body.recommendationId,
            feedbackType: body.feedbackType,
        });

        return NextResponse.json({ feedback, status: "recorded" }, { status: 200 });
    } catch (error) {
        console.error("Error submitting recommendation feedback:", error);
        const message = error instanceof Error ? error.message : "Failed to submit recommendation feedback";
        const status = message.includes("not found") ? 404 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}