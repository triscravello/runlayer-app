import type { RecommendationGearItem, UserPreferenceInput } from "../types/recommendationEngine";
export function seasonalScorer(preferences: UserPreferenceInput, item: RecommendationGearItem): number {
    if (!preferences.season) return 0;
    const tags = item.tags.join(' ').toLowerCase();
    if (preferences.season === 'winter' && tags.includes('winter')) return 6;
    if (preferences.season === 'summer' && tags.includes('summer')) return 6;
    if (preferences.season === 'shoulder' && (tags.includes('spring') || tags.includes('fall') || tags.includes('shoulder'))) return 4;
    return 0;
}