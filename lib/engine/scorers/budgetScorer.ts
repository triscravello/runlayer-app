import type { RecommendationGearItem, UserPreferenceInput } from "../types/recommendationEngine";

const priceRank: Record<string, number> = {
    budget: 1,
    mid: 2,
    premium: 3,
};

const sensitivityWeight: Record<string, number> = {
    low: 1,
    medium: 4,
    high: 7,
}

export function budgetScorer(preferences: UserPreferenceInput, item: RecommendationGearItem): number {
    const priceRange = item.priceRange?.toLowerCase();
    const targetBudget = preferences.budgetRange?.toLowerCase();
    const sensitivity = preferences.budgetSensitivity?.toLowerCase() ?? "medium";

    if (!priceRange || !targetBudget || !priceRank[priceRange] || !priceRank[targetBudget]) return 0;

    const weight = sensitivityWeight[sensitivity] ?? sensitivityWeight.medium;
    const delta = priceRank[targetBudget] - priceRank[priceRange];

    if (delta === 0) return weight;
    if (delta > 0) return Math.max(1, Math.round(weight / 2));

    return delta * weight;
}