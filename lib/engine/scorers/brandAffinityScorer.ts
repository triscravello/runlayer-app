import type { RecommendationGearItem, UserPreferenceInput } from "../types/recommendationEngine";

function normalize(value?: string | null) {
    return value?.trim().toLowerCase() ?? "";
}

export function brandAffinityScorer(preferences: UserPreferenceInput, item: RecommendationGearItem): number {
    const preferredBrands = [
        ...(preferences.favoriteBrands ?? []),
        ...(preferences.preferredBrands ?? []),
    ].map(normalize).filter(Boolean);

    const itemBrandIds = [item.brandId, item.brandName].map(normalize).filter(Boolean);

    if (!preferredBrands.length || !itemBrandIds.length) return 0;

    return itemBrandIds.some((brand) => preferredBrands.includes(brand)) ? 6 : 0;
}