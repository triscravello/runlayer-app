import type { Prisma, RecommendationFeedbackType } from "@prisma/client";
import { listGearRecommendationCandidates } from "@/lib/db/gearRepository";
import { createGeneratedOutfit, CreateRecommendationInput, listGeneratedOutfits } from "@/lib/db/outfitRepository";
import { createRecommendationHistory, listRecommendationHistoryByUserId } from "@/lib/db/recommendationRepository";
import { findRecommendationItemForUser, upsertRecommendationFeedback } from "@/lib/db/recommendationFeedbackRepository";
import { buildAlternativesByCategory, buildRecommendedOutfit, diversifyRecommendationsByCategory, flattenAlternativesByCategory, getRecommendationCategoryDiagnostics, logRecommendationSelectionDiagnostics, type GearRecommendationResult, type UserInput } from "@/lib/engine/recommendationEngine";
import { getUserProfile } from "@/lib/db/userRepository";
import { RECOMMENDATION_ENGINE_VERSION } from "@/config/recommendationEngineVersion";

import type { ScoredRecommendationItem, UserPreferenceInput } from "@/lib/engine/types/recommendationEngine";

const DEFAULT_RECOMMENDATION_LIMIT = 5;
const DEFAULT_HISTORY_LIMIT = 20;
const ALGORITHM_VERSION = RECOMMENDATION_ENGINE_VERSION;

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

function toBudgetRange(value?: string | null): UserPreferenceInput["budgetRange"] {
    const normalized = value?.toLowerCase();
    if (normalized === "budget" || normalized === "mid" || normalized === "premium") return normalized;
    return undefined;
}

function toSensitivity(value?: string | null): UserPreferenceInput["budgetSensitivity"] {
    const normalized = value?.toLowerCase();
    if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized;
    return undefined;
}

async function getRecommendationPreferences(userId?: string | null): Promise<UserPreferenceInput> {
    if (!userId) return {};

    const profile = await getUserProfile(userId);

    if (!profile) return {};

    return {
        genderPreference: profile.genderPreference?.toLowerCase(),
        favoriteBrands: profile.preferredBrands,
        preferredBrands: profile.preferredBrands,
        avoidedBrands: profile.avoidedBrands,
        budgetRange: toBudgetRange(profile.budgetLevel),
        budgetSensitivity: toSensitivity(profile.budgetSensitivity),
        heatSensitivity: profile.heatSensitivity?.toLowerCase(),
        heatTolerance: profile.heatTolerance?.toLowerCase(),
        coldTolerance: profile.coldTolerance?.toLowerCase(),
        terrainPreference: profile.terrainPreference?.toLowerCase(),
    };
}

export async function generateGearRecommendations(
    input: UserInput,
    limit = DEFAULT_RECOMMENDATION_LIMIT,
    userId?: string | null,
): Promise<GearRecommendationResult> {
    const ownerUserId = userId ?? input.userId ?? null;
    const recommendationCandidates = await listGearRecommendationCandidates();
    const preferences = await getRecommendationPreferences(ownerUserId);
    const { ranked: rankedRecommendations, diagnostics } = getRecommendationCategoryDiagnostics(input, recommendationCandidates, preferences);
    const outfitCandidates = diversifyRecommendationsByCategory(rankedRecommendations, limit);
    const recommendedOutfit = buildRecommendedOutfit(outfitCandidates);
    const alternativesByCategory = buildAlternativesByCategory(rankedRecommendations, recommendedOutfit);
    const alternatives = flattenAlternativesByCategory(alternativesByCategory);
    logRecommendationSelectionDiagnostics(rankedRecommendations, outfitCandidates, recommendedOutfit, alternativesByCategory);
    const recommendations = [
        ...outfitCandidates,
        ...alternatives.filter((alternative) => !outfitCandidates.some((item) => item.item.id === alternative.item.id))
    ];

    if (!ownerUserId) {
        return { 
            recommendations, 
            recommendedOutfit, 
            alternatives, 
            alternativesByCategory,
            engineVersion: RECOMMENDATION_ENGINE_VERSION, 
            generatedAt: new Date().toISOString(),
            ...(diagnostics ? { diagnostics } : {}),
        };
    }

    const output = {
        recommendedOutfit: recommendedOutfit ? Object.fromEntries(Object.entries(recommendedOutfit).map(([slot, recommendation]) => [slot, recommendation?.item.id])) : null,
        alternatives: alternatives.map((recommendation) => recommendation.item.id),
        alternativesByCategory: Object.fromEntries(Object.entries(alternativesByCategory).map(([category, categoryAlternatives]) => [
            category,
            categoryAlternatives.map((recommendation) => recommendation.item.id),
        ])),
        recommendations: recommendations.map(({ item, totalScore, scoreBreakdown, reasons }) => ({
            itemId: item.id,
            totalScore,
            breakdown: scoreBreakdown,
            reasons,
        })),
    };
    const generatedAt = new Date();
    const savedHistory = await createRecommendationHistory({
        userId: ownerUserId,
        inputContext: {
            weather: input.weather ?? null,
            workoutType: input.workoutType ?? null,
            terrain: input.terrain ?? null,
            category: input.category ?? null,
            preferences,
        } as Prisma.InputJsonValue,
        output: output as Prisma.InputJsonValue,
        topScore: recommendations[0]?.totalScore ?? null,
        algorithmVersion: ALGORITHM_VERSION,
        engineVersion: RECOMMENDATION_ENGINE_VERSION,
        generatedAt,
        recommendations,
    });

    const persistedRecommendations = withPersistedRecommendationIds(recommendations, savedHistory);
    const persistedRecommendationByGearId = new Map(persistedRecommendations.map((recommendation) => [recommendation.item.id, recommendation]));
    const attachPersistedRecommendationIds = (items: ScoredRecommendationItem[]) => items.map((item) => persistedRecommendationByGearId.get(item.item.id) ?? item);

    return { 
        historyId: savedHistory.id,
        engineVersion: savedHistory.engineVersion,
        generatedAt: savedHistory.generatedAt.toISOString(),
        recommendations: persistedRecommendations,
        recommendedOutfit: recommendedOutfit ? Object.fromEntries(
            Object.entries(recommendedOutfit).map(([slot, recommendation]) => [
                slot,
                recommendation ? persistedRecommendationByGearId.get(recommendation.item.id) ?? recommendation : undefined,
            ]),
        ) : undefined,
        alternatives: attachPersistedRecommendationIds(alternatives),
        alternativesByCategory: Object.fromEntries(Object.entries(alternativesByCategory).map(([category, categoryAlternatives]) => [
            category,
            attachPersistedRecommendationIds(categoryAlternatives)
        ])) as GearRecommendationResult["alternativesByCategory"],
        ...(diagnostics ? { diagnostics } : {}),
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