import type { RecommendationGearItem, UserPreferenceInput } from "../types/recommendationEngine";
export function rotationPenaltyScorer(preferences: UserPreferenceInput, item: RecommendationGearItem): number {
    let p = 0;
    if (preferences.recentRecommendedItemIds?.includes(item.id)) p = 5;
    if (preferences.frequentlySavedItemIds?.includes(item.id)) p = 3;
    return p;
}