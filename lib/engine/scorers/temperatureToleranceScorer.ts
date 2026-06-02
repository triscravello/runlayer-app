import type { RecommendationGearItem, RecommendationUserInput, UserPreferenceInput } from "../types/recommendationEngine";

function hasAnyTag(item: RecommendationGearItem, tags: string[]) {
    const tagText = item.tags.join(" ").toLowerCase();
    return tags.some((tag) => tagText.includes(tag));
}

export function temperatureToleranceScorer(
    userInput: RecommendationUserInput,
    preferences: UserPreferenceInput,
    item: RecommendationGearItem
): number {
    if (userInput.weather === "hot") {
        const heatTolerance = preferences.heatTolerance ?? preferences.heatSensitivity;
        if (heatTolerance === "low" || preferences.heatSensitivity === "high") {
            return hasAnyTag(item, ["lightweight", "breathable", "ventilated", "cooling", "summer"]) ? 7 : -3;
        }
        if (heatTolerance === "high") {
            return hasAnyTag(item, ["coverage", "insulated", "thermal"]) ? 2 : 0;
        }
    }

    if (userInput.weather === "cold") {
        const coldTolerance = preferences.coldTolerance;
        if (coldTolerance === "low") {
            return hasAnyTag(item, ["warm", "thermal", "insulated", "winter", "fleece"]) ? 7 : -3;
        }
        if (coldTolerance === "high") {
            return hasAnyTag(item, ["lightweight", "breathable"]) ? 2 : 0;
        }
    }

    return 0;
}