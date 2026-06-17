import type { RecommendationGearItem, UserPreferenceInput } from "../types/recommendationEngine";

function brandMatches(item: RecommendationGearItem, brands: string[]) {
    const normalizedBrands = brands.map((brand) => brand.toLowerCase());

    return (
        normalizedBrands.includes(item.brandId?.toLowerCase() ?? "") ||
        normalizedBrands.includes(item.brandName?.toLowerCase() ?? "")
    );
}

export function preferenceFilter(
    preferences: UserPreferenceInput,
    gearItems: RecommendationGearItem[]
) {
    return gearItems.filter((item) => {
        if (preferences.avoidedBrands?.length && brandMatches(item, preferences.avoidedBrands)) {
            return false;
        }

        // Do not hard-filter to only preferred brands.
        // Let the scorer boost preferred brands instead.
        // This avoids wiping out all candidates when brand names/ids differ.
        
        if (preferences.budgetRange && item.priceRange) {
            if (preferences.budgetRange.toLowerCase() !== item.priceRange.toLowerCase()) {
                return false;
            }
        }

        if (preferences.cushionPreference) {
            const cushionPreference = preferences.cushionPreference.toLowerCase();
            const hasTag = item.tags.some((tag) => tag.toLowerCase().includes(cushionPreference));

            if (!hasTag) {
                return false;
            }
        }

        return true;
    });
}