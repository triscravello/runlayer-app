import { genderTargetMatchesPreference } from "../filters/genderFilter";
import type { RecommendationGearItem, UserPreferenceInput } from "../types/recommendationEngine";

export function genderAlignmentScorer(preferences: UserPreferenceInput, item: RecommendationGearItem) {
    if (!preferences.genderPreference || !item.genderTarget) return 0;
    return genderTargetMatchesPreference(preferences.genderPreference, item.genderTarget) ? 0.35 : -5;
}