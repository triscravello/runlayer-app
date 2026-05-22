import type { RecommendationGearItem, RecommendationUserInput } from "../types/recommendationEngine";
export function weatherScorer(userInput: RecommendationUserInput, item: RecommendationGearItem): number { 
    if(!userInput.weather) return 0; 
    return Math.round((item.weatherSuitability?.[userInput.weather] ?? 0) * 12); 
}