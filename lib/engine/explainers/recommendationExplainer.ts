import type { RecommendationScoreBreakdown, ScoredRecommendationItem } from "../types/recommendationEngine";

const contributionLabels: Record<keyof RecommendationScoreBreakdown, string> = {
    weather: "Weather match",
    intensity: "Workout match",
    terrain: "Terrain match",
    seasonality: "Seasonal suitability",
    brandAffinity: "Preferred brand",
    brandPenalty: "Avoided brand",
    budget: "Budget preference",
    genderAlignment: "Gender preference",
    temperatureTolerance: "Temperature tolerance",
    rotationAdjustment: "Rotation adjustment",
};

const personalizedCopy: Partial<Record<keyof RecommendationScoreBreakdown, { positive: string, negative: string }>> = {
    brandAffinity: {
        positive: "Boosted because this matches one of your preferred brands",
        negative: "Penalized because this brand is not aligned with your preferences",
    },
    brandPenalty: {
        positive: "Boosted because this avoids brands you down-rank",
        negative: "Penalized because this is from a brand you avoid",
    },
    budget: {
        positive: "Boosted because the price tier fits your budget sensitivity",
        negative: "Penalized because the price tier is above your budget comfort",
    },
    genderAlignment: {
        positive: "Boosted because this item matches your gender preference",
        negative: "Penalized because this item does not match your gender preference"
    },
    temperatureTolerance: {
        positive: "Boosted because the materials match your temperature tolerance",
        negative: "Penalized because the materials may not fit your temperate tolerance",
    },
};

export function recommendationExplainer(scored: ScoredRecommendationItem): string[] {
    return (Object.entries(scored.scoreBreakdown) as Array<[keyof RecommendationScoreBreakdown, number]>)
        .filter(([, value]) => value !== 0)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([key, value]) => {
            const customCopy = personalizedCopy[key]?.[value > 0 ? "positive" : "negative"];
            const prefix = customCopy ?? `${contributionLabels[key]} ${value > 0 ? "boosted" : "penalized"} this item`;
            return `${prefix} (${value > 0 ? "+" : ""}${value})`;
        });
}