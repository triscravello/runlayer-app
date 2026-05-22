import { recommendationExplainer } from "../explainers/recommendationExplainer";
import type { RecommendationGearItem, RecommendationUserInput, ScoredRecommendationItem, UserPreferenceInput } from "../types/recommendationEngine";
import { weatherScorer } from "../scorers/weatherScorer";
import { intensityScorer } from "../scorers/intensityScorer";
import { terrainScorer } from "../scorers/terrainScorer";
import { brandAffinityScorer } from "../scorers/brandAffinityScorer";
import { seasonalScorer } from "../scorers/seasonalScorer";
import { rotationPenaltyScorer } from "../scorers/rotationPenaltyScorer";

export function recommendationRanker(userInput: RecommendationUserInput, preferences: UserPreferenceInput, gearItems: RecommendationGearItem[]): ScoredRecommendationItem[] {
    return gearItems.map((item) => {
        const contributions = {
            weather: weatherScorer(userInput, item),
            intensity: intensityScorer(userInput, item),
            terrain: terrainScorer(userInput, item),
            brandAffinity: brandAffinityScorer(preferences, item),
            seasonal: seasonalScorer(preferences, item),
            rotationPenalty: rotationPenaltyScorer(preferences, item),
        };

        const score = Object.values(contributions).reduce((a, b) => a + b, 0);
        const base = { item, score, reasons: [], contributions};
        return {...base, reasons: recommendationExplainer(base)};
    }).sort((a, b) => b.score - a.score);
}