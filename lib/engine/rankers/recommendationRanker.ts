import { recommendationExplainer } from "../explainers/recommendationExplainer";
import type { RecommendationGearItem, RecommendationScoreBreakdown, RecommendationUserInput, ScoredRecommendationItem, UserPreferenceInput } from "../types/recommendationEngine";
import { weatherScorer } from "../scorers/weatherScorer";
import { intensityScorer } from "../scorers/intensityScorer";
import { terrainScorer } from "../scorers/terrainScorer";
import { brandAffinityScorer } from "../scorers/brandAffinityScorer";
import { brandPenaltyScorer } from "../scorers/brandPenaltyScorer";
import { budgetScorer } from "../scorers/budgetScorer";
import { seasonalScorer } from "../scorers/seasonalScorer";
import { temperatureToleranceScorer } from "../scorers/temperatureToleranceScorer";
import { rotationPenaltyScorer } from "../scorers/rotationPenaltyScorer";

function sumBreakdown(breakdown: RecommendationScoreBreakdown) {
    return Object.values(breakdown).reduce((a, b) => a + b, 0);
}

function withPreferenceDefaults(userInput: RecommendationUserInput, preferences: UserPreferenceInput): RecommendationUserInput {
    if (userInput.terrain || !preferences.terrainPreference || preferences.terrainPreference === "mixed") {
        return userInput;
    }

    if (preferences.terrainPreference === "road" || preferences.terrainPreference === "trail") {
        return {
            ...userInput,
            terrain: preferences.terrainPreference,
        };
    }

    return userInput;
}

export function scoreGearItem(
    userInput: RecommendationUserInput,
    preferences: UserPreferenceInput,
    item: RecommendationGearItem,
): ScoredRecommendationItem {
    const effectiveInput = withPreferenceDefaults(userInput, preferences);
    const breakdown: RecommendationScoreBreakdown = {
        weather: weatherScorer(effectiveInput, item),
        intensity: intensityScorer(effectiveInput, item),
        terrain: terrainScorer(effectiveInput, item),
        seasonality: seasonalScorer(preferences, item),
        brandAffinity: brandAffinityScorer(preferences, item),
        brandPenalty: brandPenaltyScorer(preferences, item),
        budget: budgetScorer(preferences, item),
        temperatureTolerance: temperatureToleranceScorer(effectiveInput, preferences, item),
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

    return { ...base, reasons: recommendationExplainer(base) };
}

export function recommendationRanker(userInput: RecommendationUserInput, preferences: UserPreferenceInput, gearItems: RecommendationGearItem[]): ScoredRecommendationItem[] {
    return gearItems.map((item) => scoreGearItem(userInput, preferences, item)).sort((a, b) => b.score - a.score);
}