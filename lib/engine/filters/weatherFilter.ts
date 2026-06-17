import type { RecommendationGearItem, RecommendationUserInput } from "../types/recommendationEngine";
export function weatherFilter(userInput: RecommendationUserInput, gearItems: RecommendationGearItem[]) {
    const w = userInput.weather;
    if (!w) return gearItems;
    const filtered = gearItems.filter(i => (i.weatherSuitability?.[w] ?? 0.5) >= 0.35);
    return filtered;
}