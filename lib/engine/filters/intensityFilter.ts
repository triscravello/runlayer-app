import type { RecommendationGearItem, RecommendationUserInput } from "../types/recommendationEngine";

const intensityTagMap: Record<string, string[]> = {
    recovery: ["recovery", "daily-run", "everyday-run"],
    easy: ["easy", "daily-run", "everyday-run", "training", "recovery"],
    "long-run": ["long-run", "daily-run", "everyday-run", "training", "storage", "hydration"],
    tempo: ["tempo", "training", "race-day", "ultralight"],
    race: ["race", "race-day", "ultralight", "performance-kit"],
};

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

    return filtered.length > 0 ? filtered : gearItems;
}