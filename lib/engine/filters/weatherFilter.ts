import type { RecommendationGearItem, RecommendationUserInput } from "../types/recommendationEngine";
export function weatherFilter(userInput: RecommendationUserInput, gearItems: RecommendationGearItem[]) {
    const w = userInput.weather;
    if (!w) return gearItems;
    console.log("Before weather filter:", gearItems.length);
    const filtered = gearItems.filter(i => (i.weatherSuitability?.[w] ?? 0.5) >= 0.35);
    console.log("After weather filter:", filtered.length);
    return filtered;
}