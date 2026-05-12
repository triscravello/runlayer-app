import { listGearRecommendationCandidates } from "@/lib/db/gearRepository";
import { createGeneratedOutfit, CreateRecommendationInput, listGeneratedOutfits } from "@/lib/db/outfitRepository";
import { rankGearRecommendations, type GearRecommendationResult, type UserInput } from "@/lib/engine/recommendationEngine";

const DEFAULT_RECOMMENDATION_LIMIT = 5;

export type { CreateRecommendationInput, GearRecommendationResult, UserInput };

export async function listRecommendations() {
    return listGeneratedOutfits();
}

export async function createRecommendation(input: CreateRecommendationInput) {
    return createGeneratedOutfit(input);
}

export async function generateGearRecommendations(
    input: UserInput,
    limit = DEFAULT_RECOMMENDATION_LIMIT,
): Promise<GearRecommendationResult> {
    const recommendationCandidates = await listGearRecommendationCandidates();
    const recommendations = rankGearRecommendations(input, recommendationCandidates).slice(0, limit);

    return { recommendations };
}