import type { RecommendationGearItem, RecommendationUserInput } from "../types/recommendationEngine";
const valid = ["recovery", "easy", "long-run", "tempo", "race"];
export function intensityFilter(userInput: RecommendationUserInput, gearItems: RecommendationGearItem[]) {
    const intensity = userInput.intensity;
    if (!intensity || !valid.includes(intensity)) return gearItems;
    return gearItems.filter(i => i.tags.some(t => t.toLowerCase().includes(intensity)));
}