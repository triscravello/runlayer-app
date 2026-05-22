import type { RecommendationGearItem, RecommendationUserInput } from "../types/recommendationEngine";
export function terrainScorer(userInput: RecommendationUserInput, item: RecommendationGearItem): number {
    if (!userInput.terrain) return 0;
    return item.tags.some(t => t.toLowerCase().includes(userInput.terrain!)) ? 8 : 0;
}