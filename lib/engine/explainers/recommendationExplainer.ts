import type { RecommendationScoreBreakdown, ScoredRecommendationItem } from "../types/recommendationEngine";

const contributionLabels: Record<keyof RecommendationScoreBreakdown, string> = {
    weather: "Weather match",
    intensity: "Workout match",
    terrain: "Terrain match",
    seasonality: "Seasonal suitability",
    brandAffinity: "Brand affinity",
    rotationAdjustment: "Rotation adjustment",
};

export function recommendationExplainer(scored: ScoredRecommendationItem): string[] {
    return (Object.entries(scored.scoreBreakdown) as Array<[keyof RecommendationScoreBreakdown, number]>)
        .filter(([, value]) => value !== 0)
        .sort((a, b) => b[1] - a[1])
        .map(([key, value]) => `${contributionLabels[key]} ${value > 0 ? "boosted" : "penalized"} this item (${value > 0 ? "+" : ""}${value})`);
}