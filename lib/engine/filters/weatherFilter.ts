import type { RecommendationGearItem, RecommendationUserInput, WeatherCondition } from "../types/recommendationEngine";

const WEATHER_SUITABILITY_THRESHOLD = 0.35;
const ESSENTIAL_OUTFIT_CATEGORIES = ["top", "bottom", "accessory"] as const;

function normalizeCategory(category?: string | null) {
    return category?.trim().toLowerCase() ?? "";
}

function getWeatherSuitability(item: RecommendationGearItem, weather: WeatherCondition) {
    return item.weatherSuitability?.[weather] ?? 0.5;
}

function countCategory(items: RecommendationGearItem[], category: string) {
    return items.filter((item) => normalizeCategory(item.category) === category).length;
}

function restoreMissingEssentialCategories(
    preFilterItems: RecommendationGearItem[],
    filteredItems: RecommendationGearItem[],
    weather: WeatherCondition,
) {
    const filteredIds = new Set(filteredItems.map((item) => item.id));
    const restoredItems = [...filteredItems];

    for (const category of ESSENTIAL_OUTFIT_CATEGORIES) {
        const preFilterCount = countCategory(preFilterItems, category);
        const filteredCount = countCategory(filteredItems, category);

        if (preFilterCount === 0 || filteredCount > 0) continue;

        const bestAvailableCandidate = preFilterItems
            .filter((item) => normalizeCategory(item.category) === category && !filteredIds.has(item.id))
            .sort((a, b) => getWeatherSuitability(b, weather) - getWeatherSuitability(a, weather))[0];

        if (!bestAvailableCandidate) continue;

        restoredItems.push(bestAvailableCandidate);
        filteredIds.add(bestAvailableCandidate.id);
    }

    return restoredItems;
}

export function weatherFilter(userInput: RecommendationUserInput, gearItems: RecommendationGearItem[]) {
    const weather = userInput.weather;
    if (!weather) return gearItems;
    const filtered = gearItems.filter((item) => getWeatherSuitability(item, weather) >= WEATHER_SUITABILITY_THRESHOLD);
    return restoreMissingEssentialCategories(gearItems, filtered, weather);
}