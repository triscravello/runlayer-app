import { getRankedGearRecommendations, type GearRecommendationResult } from "@/lib/db/gearRepository";
import { createGeneratedOutfit, listGeneratedOutfits, type CreateRecommendationInput } from "@/lib/db/outfitRepository";
import type { UserInput } from "@/lib/engine/recommendationEngine";

export type { GearRecommendationResult };

export async function listRecommendations() {
    return listGeneratedOutfits();
}

export async function createRecommendation(input: CreateRecommendationInput) {
    return createGeneratedOutfit(input);
}

export async function generateGearRecommendations(
    input: UserInput,
    limit?: number,
): Promise<GearRecommendationResult> {
    return getRankedGearRecommendations(input, limit);
}