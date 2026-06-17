import type { RecommendationGearItem, UserPreferenceInput } from "../types/recommendationEngine";

const malePreferences = new Set(["male", "men", "man"]);
const femalePreferences = new Set(["female", "women", "woman"]);
const unisexTargets = new Set(["unisex", "all", "any"]);
const menTargets = new Set(["male", "men", "man"]);
const womenTargets = new Set(["female", "women", "woman"]);

function normalize(value?: string | null) {
    return value?.trim().toLowerCase();
}

export function genderTargetMatchesPreference(preference?: string | null, target?: string | null) {
    const normalizedPreference = normalize(preference);
    const normalizedTarget = normalize(target);

    if (!normalizedPreference || !normalizedTarget || unisexTargets.has(normalizedTarget)) {
        return true;
    }

    if (malePreferences.has(normalizedPreference)) {
        return menTargets.has(normalizedTarget);
    }

    if (femalePreferences.has(normalizedPreference)) {
        return womenTargets.has(normalizedTarget);
    }

    return true;
}

export function genderFilter(preferences: UserPreferenceInput, gearItems: RecommendationGearItem[]) {
    if (!normalize(preferences.genderPreference)) {
        return gearItems;
    }

    return gearItems.filter((item) => genderTargetMatchesPreference(preferences.genderPreference, item.genderTarget));
}