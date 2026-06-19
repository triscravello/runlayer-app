import type { RecommendationScoreBreakdown, ScoredRecommendationItem } from "../types/recommendationEngine";

const contributionLabels: Record<keyof RecommendationScoreBreakdown, string> = {
    weather: "Ready for today's condition",
    intensity: "Fits the planned effort",
    terrain: "Suited to your route surface",
    seasonality: "Seasonally appropriate",
    brandAffinity: "From a brand you tend to like",
    brandPenalty: "Brand preference mismatch",
    budget: "Fits your budget comfort zone",
    genderAlignment: "Matches your fit profile",
    temperatureTolerance: "Matches your temperature preferences",
    rotationAdjustment: "Adds variety to your recent recommendations",
};

const personalizedCopy: Partial<Record<keyof RecommendationScoreBreakdown, { positive: string, negative: string }>> = {
    brandAffinity: {
        positive: "From a brand you tend to like",
        negative: "Not as close to your usual brand preferences",
    },
    brandPenalty: {
        positive: "Avoids brands you prefer to down-rank",
        negative: "From a brand you asked us to de-prioritize",
    },
    budget: {
        positive: "Fits your budget comfort zone",
        negative: "May sit above your preferred budget range",
    },
    genderAlignment: {
        positive: "Available in your preferred sizing category",
        negative: "Less aligned with your fit profile"
    },
    temperatureTolerance: {
        positive: "Matches your temperature preferences",
        negative: "May run warmer or cooler than you prefer",
    },
    rotationAdjustment: {
        positive: "Adds variety to your recent recommendations",
        negative: "Similar to gear recommended recently",
    },
};

export function recommendationExplainer(scored: ScoredRecommendationItem): string[] {
    return (Object.entries(scored.scoreBreakdown) as Array<[keyof RecommendationScoreBreakdown, number]>)
        .filter(([, value]) => value !== 0)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([key, value]) => personalizedCopy[key]?.[value > 0 ? "positive" : "negative"] ?? contributionLabels[key]);
}