import type { RecommendationGearItem, RecommendationUserInput } from "../types/recommendationEngine";

const intensityTagMap: Record<string, string[]> = {
    recovery: ["recovery"],
    easy: ["easy", "daily-run", "everyday-run"],
    "long-run": ["long-run", "hydration", "storage"],
    tempo: ["tempo"],
    intervals: ["intervals", "speedwork", "high-output", "tempo", "race-day", "ultralight", "performance-fit"],
    race: ["race", "race-day"],
};

export function intensityScorer(userInput: RecommendationUserInput, item: RecommendationGearItem): number {
    const intensity = userInput.intensity?.toLowerCase();
    if (!intensity) return 0;

    const tags = item.tags.map((tag) => tag.toLowerCase());
    const acceptedTags = intensityTagMap[intensity] ?? [intensity];
    const matchedTags = acceptedTags.filter((tag) => tags.includes(tag));

    if (intensity === "race" && matchedTags.length > 0) return 15;
    if (intensity === "intervals" && matchedTags.length > 0) return matchedTags.includes("intervals") || matchedTags.includes("speedwork") || matchedTags.includes("high-output") ? 15 : 10;

    return matchedTags.length > 0 ? 10 : 0;
}