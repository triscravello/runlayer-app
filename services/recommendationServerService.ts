import type { Prisma, RecommendationFeedbackType } from "@prisma/client";
import { listGearRecommendationCandidates } from "@/lib/db/gearRepository";
import { createGeneratedOutfit, CreateRecommendationInput, listGeneratedOutfits } from "@/lib/db/outfitRepository";
import { createRecommendationHistory, listRecommendationHistoryByUserId } from "@/lib/db/recommendationRepository";
import { findRecommendationItemForUser, upsertRecommendationFeedback } from "@/lib/db/recommendationFeedbackRepository";
import { rankGearRecommendations, type GearRecommendationResult, type UserInput } from "@/lib/engine/recommendationEngine";

import type { ScoredRecommendationItem } from "@/lib/engine/types/recommendationEngine";

const DEFAULT_RECOMMENDATION_LIMIT = 5;
const DEFAULT_HISTORY_LIMIT = 20;
const ALGORITHM_VERSION = "recommendation-score-breakdown-v1";

export type { CreateRecommendationInput, GearRecommendationResult, UserInput };

export async function listRecommendations() {
    return listGeneratedOutfits();
}

export async function createRecommendation(input: CreateRecommendationInput) {
    return createGeneratedOutfit(input);
}

function withPersistedRecommendationIds(
    recommendations: ScoredRecommendationItem[],
    savedHistory: Awaited<ReturnType<typeof createRecommendationHistory>>,
) {
    const historyItemByGearId = new Map(savedHistory.items.map((item) => [item.gearItemId, item.id]));

    return recommendations.map((recommendation) => ({
        ...recommendation,
        recommendationId: historyItemByGearId.get(recommendation.item.id),
    }));
}

export async function generateGearRecommendations(
    input: UserInput,
    limit = DEFAULT_RECOMMENDATION_LIMIT,
    userId?: string | null,
): Promise<GearRecommendationResult> {
    const recommendationCandidates = await listGearRecommendationCandidates();
    const recommendations = rankGearRecommendations(input, recommendationCandidates).slice(0, limit);
    const ownerUserId = userId ?? input.userId ?? null;

    if (!ownerUserId) {
        return { recommendations };
    }

    const output = {
        recommendations: recommendations.map(({ item, totalScore, scoreBreakdown, reasons }) => ({
            itemId: item.id,
            totalScore,
            breakdown: scoreBreakdown,
            reasons,
        })),
    };
    const savedHistory = await createRecommendationHistory({
        userId: ownerUserId,
        inputContext: {
            weather: input.weather ?? null,
            workoutType: input.workoutType ?? null,
            terrain: input.terrain ?? null,
            category: input.category ?? null,
        } as Prisma.InputJsonValue,
        output: output as Prisma.InputJsonValue,
        topScore: recommendations[0]?.totalScore ?? null,
        algorithmVersion: ALGORITHM_VERSION,
        recommendations,
    });

    return { 
        historyId: savedHistory.id,
        recommendations: withPersistedRecommendationIds(recommendations, savedHistory), 
    };
}

export async function getRecommendationHistory(userId: string, options: { limit?: number; offset?: number } = {}) {
    return listRecommendationHistoryByUserId({
        userId,
        take: options.limit ?? DEFAULT_HISTORY_LIMIT,
        skip: options.offset ?? 0,
    });
}

export async function submitRecommendationFeedback(input: {
    userId: string;
    recommendationId: string;
    feedbackType: RecommendationFeedbackType;
}) {
    const recommendationItem = await findRecommendationItemForUser(input.recommendationId, input.userId);

    if (!recommendationItem) {
        throw new Error("Recommendation not found for this user.");
    }

    return upsertRecommendationFeedback(input);
}