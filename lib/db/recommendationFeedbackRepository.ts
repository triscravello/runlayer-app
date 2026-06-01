import type { RecommendationFeedbackType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type UpsertRecommendationFeedbackInput = {
    recommendationId: string;
    userId: string;
    feedbackType: RecommendationFeedbackType;
}

export async function upsertRecommendationFeedback(input: UpsertRecommendationFeedbackInput) {
    return prisma.recommendationFeedback.upsert({
        where: {
            recommendationId_userId: {
                recommendationId: input.recommendationId,
                userId: input.userId,
            },
        },
        update: {
            feedbackType: input.feedbackType,
        },
        create: {
            recommendationId: input.recommendationId,
            userId: input.userId,
            feedbackType: input.feedbackType,
        },
    });
}

export async function findRecommendationItemForUser(recommendationId: string, userId: string) {
    return prisma.recommendationItem.findFirst({
        where: {
            id: recommendationId,
            recommendation: {
                userId,
            },
        },
    });
}