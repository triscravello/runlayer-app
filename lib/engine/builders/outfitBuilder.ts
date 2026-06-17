import type { ScoredRecommendationItem } from "../types/recommendationEngine";

export type OutfitResult = {
    score: number;
    reasons: string[];
    items: {
        top?: unknown;
        bottom?: unknown;
        outerwear?: unknown;
        accessory?: unknown;
        socks?: unknown;
        hat?: unknown;
        gloves?: unknown;
    };
};

export function outfitBuilder(scoredItems: ScoredRecommendationItem[]): OutfitResult[] {
    const by = (category: string) =>
        scoredItems.filter(
            (scoredItem) =>
                scoredItem.item.category?.toLowerCase() === category.toLowerCase()
        );

    const top = by("top")[0];
    const bottom = by("bottom")[0];

    if (!top || !bottom) return [];

    const outerwear = by("outerwear")[0];
    const accessory = by("accessory")[0];

    const parts = [top, bottom, outerwear, accessory].filter(Boolean) as ScoredRecommendationItem[];

    const avg = parts.reduce((total, part) => total + part.score, 0) / parts.length;

    const cohesion = parts.every((part) =>
        part.item.tags.some((tag) => top.item.tags.includes(tag))
    )
        ? 3
        : 0;

    const layering = outerwear ? 2 : 0;

    return [
        {
            score: avg + cohesion + layering,
            reasons: ["Optimized for cohesive conditions", "Layering compatibility validated"],
            items: {
                top: top.item,
                bottom: bottom.item,
                outerwear: outerwear?.item,
                accessory: accessory?.item,
            },
        },
    ];
}