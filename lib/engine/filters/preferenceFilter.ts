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

        // Do not hard-filter to only preferred brands or budget matches.
        // Brand affinity and budget alignment are scoring inputs, not eligibility checks.
        // This preserves complete outfits when a category has no preferred-brand or exact-budget items.

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