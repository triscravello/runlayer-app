import type { RecommendationGearItem, RecommendationUserInput } from "../types/recommendationEngine";
export function intensityScorer(userInput: RecommendationUserInput, item: RecommendationGearItem): number {
    if (!userInput.intensity) return 0;
    const tag = item.tags.join(" ").toLowerCase();
    if (userInput.intensity === "race" && tag.includes("race")) return 15;
    return tag.includes(userInput.intensity) ? 10 : 0;
}