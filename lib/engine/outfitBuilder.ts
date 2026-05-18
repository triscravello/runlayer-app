import { OUTFIT_RULES, WEATHER_THRESHOLDS } from "@/config/scoring";
import { getBrandBias, type BrandPreferenceInput, type BrandMappableItem } from "@/lib/engine/brandMapper";
import {
    scoreItemForConditions,
    type ConditionScoreableGearItem,
    type ConditionScoreResult,
    type WeatherInput,
} from "@/lib/engine/conditionScorer";
import { groupBy } from "@/lib/utils/collection";
import { clamp, roundTo } from "@/lib/utils/math";
import { normalizeText, titleCase } from "@/lib/utils/text";

export type OutfitBuildUserProfile = BrandPreferenceInput & {
    gender?: string | null;
    bodyType?: string | null;
    preferredFit?: string | null;
    heatSensitivity?: string | null;
    chafeProne?: boolean | null;
};

export type OutfitGearItem = ConditionScoreableGearItem & BrandMappableItem & {
    id: string;
    name: string;
    genderTarget?: string | null;
    bodyTypeFit?: string[] | null;
    priceRange?: string | null;
};

export type ScoredOutfitItem<TItem extends OutfitGearItem = OutfitGearItem> = ConditionScoreResult<TItem> & {
    brandMultiplier: number;
    brandExplanation: string;
    adjustedScore: number;
};

export type OutfitCandidate<TItem extends OutfitGearItem = OutfitGearItem> = {
    items: {
        top: TItem;
        bottom: TItem;
        accessories?: TItem[];
    };
    score: number;
    explanation: string[];
    itemScores: Array<{
        itemId: string;
        name: string;
        category: string;
        score: number;
        breakdown: ConditionScoreResult<TItem>["breakdown"];
    }>;
};

export type OutfitBuilderResult<TItem extends OutfitGearItem = OutfitGearItem> = {
    outfits: Array<OutfitCandidate<TItem>>;
};

type CategoryKey = "top" | "bottom" | "accessory";

function getCategory(item: { category?: string | null }): CategoryKey | "unknown" {
    const category = normalizeText(item.category);

    if (category === "top" || category === "bottom" || category === "accessory") {
        return category;
    }

    return "unknown";
}

function isGenderCompatible(item: OutfitGearItem, profile: OutfitBuildUserProfile): boolean {
    const requestedGender = normalizeText(profile.gender);
    const targetGender = normalizeText(item.genderTarget);

    if (!requestedGender || !targetGender || targetGender === "unisex") {
        return true;
    }

    return requestedGender === targetGender;
}

function getWeatherSuitability(item: OutfitGearItem, key: "rain" | "wind"): number {
    const value = item.weatherSuitability?.[key];

    if (typeof value === "number") {
        return clamp(value);
    }

    const denormalized = key === "rain" ? item.weatherRain : item.weatherWind;
    return typeof denormalized === "number" ? clamp(denormalized) : 0.5;
}

function passesWeatherConstraints(item: OutfitGearItem, weather: WeatherInput): boolean {
    const category = getCategory(item);

    if (category === "unknown") {
        return false;
    }

    const precipitationChance = weather.precipitationChance ?? 0;
    const windSpeed = weather.windSpeed ?? 0;

    if (precipitationChance >= WEATHER_THRESHOLDS.heavyRainChance) {
        return getWeatherSuitability(item, "rain") >= OUTFIT_RULES.servereRainMinimumSuitability;
    }

    if (windSpeed >= WEATHER_THRESHOLDS.veryWindyMph) {
        return getWeatherSuitability(item, "wind") >= OUTFIT_RULES.severeWindMinimumSuitability;
    }

    return true;
}

function scoreBodyFit(item: OutfitGearItem, profile: OutfitBuildUserProfile): number {
    const bodyType = normalizeText(profile.bodyType);

    if (!bodyType || !item.bodyTypeFit?.length) {
        return 1;
    }

    return item.bodyTypeFit.map(normalizeText).includes(bodyType) ? 1.03 : 0.97;
}

function scoreItem<TItem extends OutfitGearItem>(
    item: TItem,
    weather: WeatherInput,
    profile: OutfitBuildUserProfile,
): ScoredOutfitItem<TItem> {
    const conditionScore = scoreItemForConditions(item, weather);
    const brandBias = getBrandBias(item, profile);
    const bodyFitMultiplier = scoreBodyFit(item, profile);
    const adjustedScore = roundTo(conditionScore.score * brandBias.multiplier * bodyFitMultiplier, 1);

    return {
        ...conditionScore,
        brandMultiplier: brandBias.multiplier,
        brandExplanation: brandBias.explanation,
        adjustedScore,
    };
}

function sortScoredItems<TItem extends OutfitGearItem>(items: Array<ScoredOutfitItem<TItem>>): Array<ScoredOutfitItem<TItem>> {
    return [...items].sort((left, right) => (
        right.adjustedScore - left.adjustedScore
        || normalizeText(left.item.name).localeCompare(normalizeText(right.item.name))
        || left.item.id.localeCompare(right.item.id)
    ));
}

function topCandidates<TItem extends OutfitGearItem>(items: Array<ScoredOutfitItem<TItem>>): Array<ScoredOutfitItem<TItem>> {
    return sortScoredItems(items).slice(0, OUTFIT_RULES.maxCandidatesPerCategory);
}

function getAverageScore(items: Array<ScoredOutfitItem<OutfitGearItem>>): number {
    if (!items.length) {
        return 0;
    }

    return items.reduce((sum, item) => sum + item.adjustedScore, 0) / items.length;
}

function buildExplanation<TItem extends OutfitGearItem>(items: Array<ScoredOutfitItem<TItem>>, weather: WeatherInput): string[] {
    const precipitationChance = weather.precipitationChance ?? 0;
    const windSpeed = weather.windSpeed ?? 0;
    const explanations = [
        `Selected highest-scoring compatible top and bottom to satisfy outfit completeness.`,
        `Average item score is based on temperature, precipitation, wind, layering, category fit, and brand preference.`,
    ];

    if (precipitationChance >= WEATHER_THRESHOLDS.rainLikelyChance) {
        explanations.push(`Rain constraints were applied because precipitation chance is ${Math.round(precipitationChance * 100)}%.`);
    }

    if (windSpeed >= WEATHER_THRESHOLDS.windyMph) {
        explanations.push(`Wind constraints were considered because wind speed is ${Math.round(windSpeed)} mph.`);
    }

    for (const scoredItem of items) {
        const itemReason = scoredItem.explanation[0] ?? "Matched the weather context.";
        explanations.push(`${scoredItem.item.name}: ${itemReason} ${scoredItem.brandExplanation}`);
    }

    return explanations;
}

function toItemScore<TItem extends OutfitGearItem>(scoredItem: ScoredOutfitItem<TItem>) {
    return {
        itemId: scoredItem.item.id,
        name: scoredItem.item.name,
        category: titleCase(getCategory(scoredItem.item)),
        score: scoredItem.adjustedScore,
        breakdown: scoredItem.breakdown,
    };
}

function combinationKey(items: readonly OutfitGearItem[]): string {
    return items.map((item) => item.id).sort().join("|");
}

export function buildOutfits<TItem extends OutfitGearItem>(
    items: readonly TItem[],
    weather: WeatherInput,
    profile: OutfitBuildUserProfile = {},
): OutfitBuilderResult<TItem> {
    const scoredItems = items
        .filter((item) => isGenderCompatible(item, profile))
        .filter((item) => passesWeatherConstraints(item, weather))
        .map((item) => scoreItem(item, weather, profile));

    const groupedItems = groupBy(scoredItems, (scoredItem) => getCategory(scoredItem.item));
    const tops = topCandidates(groupedItems.top ?? []);
    const bottoms = topCandidates(groupedItems.bottom ?? []);
    const accessories = topCandidates(groupedItems.accessory ?? []);

    if (!tops.length || !bottoms.length) {
        return { outfits: [] };
    }

    const seen = new Set<string>();
    const candidates: Array<OutfitCandidate<TItem>> = [];

    for (const top of tops) {
        for (const bottom of bottoms) {
            const accessorySets: Array<Array<ScoredOutfitItem<TItem>>> = [
                [],
                ...accessories.slice(0, OUTFIT_RULES.maxAccessories).map((accessory) => [accessory]),
            ];
        }
    }

    return {
        outfits: candidates
            .sort((left, right) => right.score - left.score || combinationKey(Object.values(left.items).flat().filter(Boolean) as TItem[]).localeCompare(
                combinationKey(Object.values(right.items).flat().filter(Boolean) as TItem[]),
            ))
            .slice(0, OUTFIT_RULES.maxOutfits),
    };
}