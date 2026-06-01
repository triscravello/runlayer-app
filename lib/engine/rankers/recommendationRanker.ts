import { recommendationExplainer } from "../explainers/recommendationExplainer";
import type { RecommendationGearItem, RecommendationScoreBreakdown, RecommendationUserInput, ScoredRecommendationItem, UserPreferenceInput } from "../types/recommendationEngine";
import { weatherScorer } from "../scorers/weatherScorer";
import { intensityScorer } from "../scorers/intensityScorer";
import { terrainScorer } from "../scorers/terrainScorer";
import { brandAffinityScorer } from "../scorers/brandAffinityScorer";
import { seasonalScorer } from "../scorers/seasonalScorer";
import { rotationPenaltyScorer } from "../scorers/rotationPenaltyScorer";

function sumBreakdown(breakdown: RecommendationScoreBreakdown) {
    return Object.values(breakdown).reduce((a, b) => a + b, 0);
}

export function recommendationRanker(userInput: RecommendationUserInput, preferences: UserPreferenceInput, gearItems: RecommendationGearItem[]): ScoredRecommendationItem[] {
    return gearItems.map((item) => {
        const breakdown: RecommendationScoreBreakdown = {
            weather: weatherScorer(userInput, item),
            intensity: intensityScorer(userInput, item),
            terrain: terrainScorer(userInput, item),
            seasonality: seasonalScorer(preferences, item),
            brandAffinity: brandAffinityScorer(preferences, item),
            rotationAdjustment: rotationPenaltyScorer(preferences, item),
        };

        const totalScore = sumBreakdown(breakdown);
        const base = {
            item, 
            score: totalScore,
            totalScore,
            scoreBreakdown: breakdown,
            breakdown,
            reasons: [],
            contributions: breakdown,
        };
        return {...base, reasons: recommendationExplainer(base)};
    }).sort((a, b) => b.score - a.score);
}