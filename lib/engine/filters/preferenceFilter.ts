import type { RecommendationGearItem, UserPreferenceInput } from "../types/recommendationEngine";
export function preferenceFilter(preferences: UserPreferenceInput, gearItems: RecommendationGearItem[]) {
    return gearItems.filter(i => {
        if (preferences.avoidedBrands?.includes(i.brandId ?? "")) return false;
        if (preferences.preferredBrands?.length && !preferences.preferredBrands.includes(i.brandId ?? "")) return false;
        if (preferences.budgetRange && i.priceRange && preferences.budgetRange !== i.priceRange) return false;
        if (preferences.cushionPreference) {
            const has = i.tags.some(t => t.toLowerCase().includes(preferences.cushionPreference!));
            if (!has) return false;
        }

        return true;
    });
}