import type { RecommendationGearItem, UserPreferenceInput } from "../types/recommendationEngine";

function normalize(value?: string | null) {
    return value?.trim().toLowerCase() ?? "";
}

export function brandPenaltyScorer(preferences: UserPreferenceInput, item: RecommendationGearItem) {
    const avoidedBrands = preferences.avoidedBrands?.map(normalize).filter(Boolean) ?? [];
    const itemBrandIds = [item.brandId, item.brandName].map(normalize).filter(Boolean);

    if (!avoidedBrands.length || !itemBrandIds.length) return 0;

    return itemBrandIds.some((brand) => avoidedBrands.includes(brand)) ? -12 : 0;
}