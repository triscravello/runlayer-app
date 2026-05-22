import type { RecommendationGearItem, UserPreferenceInput } from "../types/recommendationEngine";
export function brandAffinityScorer(preferences: UserPreferenceInput, item: RecommendationGearItem): number {
    return preferences.favoriteBrands?.includes(item.brandId ?? "") ? 4 : 0;
}