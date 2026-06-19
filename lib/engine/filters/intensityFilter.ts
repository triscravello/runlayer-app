import type { RecommendationGearItem, RecommendationUserInput } from "../types/recommendationEngine";

const intensityTagMap: Record<string, string[]> = {
    recovery: ["recovery", "daily-run", "everyday-run"],
    easy: ["easy", "daily-run", "everyday-run", "training", "recovery"],
    "long-run": ["long-run", "daily-run", "everyday-run", "training", "storage", "hydration"],
    tempo: ["tempo", "training", "race-day", "ultralight"],
    race: ["race", "race-day", "ultralight", "performance-kit"],
};

const preservedOutfitCategories = ["top", "bottom", "accessory"] as const;

function normalizeCategory(category?: string | null) {
    return category?.trim().toLowerCase() ?? "";
}

function countCategory(items: RecommendationGearItem[], category: string) {
    return items.filter((item) => normalizeCategory(item.category) === category).length;
}

function restoreMissingOutfitCategories(
    preFilterItems: RecommendationGearItem[],
    filteredItems: RecommendationGearItem[],
) {
    const filteredIds = new Set(filteredItems.map((item) => item.id));
    const restoredItems = [...filteredItems];

    for (const category of preservedOutfitCategories) {
        const preFilterCount = countCategory(preFilterItems, category);
        const filteredCount = countCategory(filteredItems, category);

        if (preFilterCount === 0 || filteredCount > 0) continue;

        for (const item of preFilterItems) {
            if (normalizeCategory(item.category) !== category || filteredIds.has(item.id)) continue;

            restoredItems.push(item);
            filteredIds.add(item.id);
        }
    }

    return restoredItems;
}

export function intensityFilter(
    userInput: RecommendationUserInput, 
    gearItems: RecommendationGearItem[]
) {
    const intensity = userInput.intensity?.toLowerCase();

    if (!intensity || intensity === "all") {
        return gearItems;
    }

    const acceptedTags = intensityTagMap[intensity];

    if (!acceptedTags) {
        return gearItems;
    }

    const filtered = gearItems.filter((item) => 
        item.tags.some((tag) => acceptedTags.includes(tag.toLowerCase()))
    );

    if (filtered.length === 0) {
        return gearItems;
    }

    return restoreMissingOutfitCategories(gearItems, filtered);
}