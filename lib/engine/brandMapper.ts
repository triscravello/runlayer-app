import { BRAND_MULTIPLIERS, BRAND_SCORE_LIMITS } from "@/config/brandConfig";
import { clamp, roundTo } from "../utils/math";
import { normalizeText } from "../utils/text";

export type BrandMappableItem = {
    brandId?: string | null;
    brand?: {
        id?: string | null;
        name?: string | null;
    } | null;
} 

export type BrandPreferenceInput = {
    preferredBrands?: readonly string[] | null;
    dislikedBrands?: readonly string[] | null;
    neutralBrands?: readonly string[] | null;
    savedBrands?: readonly string[] | null;
}

export type BrandBias = "preferred" | "saved" | "neutral" | "disliked" | "unknown";

export type BrandMultiplierResult<TItem extends BrandMappableItem = BrandMappableItem> = {
    item: TItem,
    bias: BrandBias,
    multiplier: number;
    explanation: string;
}

export type BrandAdjustedScore<TItem extends BrandMappableItem = BrandMappableItem> = BrandMultiplierResult<TItem> & {
    baseScore: number;
    adjustedScore: number;
};

function normalizeBrandSet(brands: readonly string[] | null | undefined): Set<string> {
    return new Set((brands ?? []).map(normalizeText).filter(Boolean));
}

function getBrandKeys(item: BrandMappableItem): string[] {
    return [item.brandId, item.brand?.id, item.brand?.name].map(normalizeText).filter(Boolean);
}

function hasBrandMatch(keys: readonly string[], brandSet: Set<string>): boolean {
    return keys.some((key) => brandSet.has(key));
}

export function getBrandBias<TItem extends BrandMappableItem>(
    item: TItem,
    preferences: BrandPreferenceInput = {},
): BrandMultiplierResult<TItem> {
    const brandKeys = getBrandKeys(item);
    const preferredBrands = normalizeBrandSet(preferences.preferredBrands);
    const dislikedBrands = normalizeBrandSet(preferences.dislikedBrands);
    const neutralBrands = normalizeBrandSet(preferences.neutralBrands);
    const savedBrands = normalizeBrandSet(preferences.savedBrands);

    if (hasBrandMatch(brandKeys, dislikedBrands)) {
        return {
            item,
            bias: "disliked",
            multiplier: BRAND_MULTIPLIERS.disliked,
            explanation: "Brand is marked as disliked, so its score is reduced.",
        };
    }

    if (hasBrandMatch(brandKeys, preferredBrands)) {
        return {
            item,
            bias: "preferred",
            multiplier: BRAND_MULTIPLIERS.preferred,
            explanation: "Brand matches a preferred brand, so its score receives a positive bias.",
        };
    }

    if (hasBrandMatch(brandKeys, savedBrands)) {
        return {
            item,
            bias: "saved",
            multiplier: BRAND_MULTIPLIERS.saved,
            explanation: "Brand appears in saved outfits, so its score receives a small familiarity boost.",
        };
    };

    if (hasBrandMatch(brandKeys, neutralBrands)) {
        return {
            item,
            bias: "neutral",
            multiplier: BRAND_MULTIPLIERS.neutral,
            explanation: "Brand is explicitly neutral, so no score bias is applied.",
        };
    }

    return {
        item,
        bias: "unknown",
        multiplier: BRAND_MULTIPLIERS.unknown,
        explanation: "No brand preference matched, so no score bias is applied.",
    };
}

export function applyBrandMultiplier(score: number, multiplier: number): number {
    const boundedMultiplier = clamp(
        multiplier, 
        BRAND_SCORE_LIMITS.minMultiplier,
        BRAND_SCORE_LIMITS.maxMultiplier,
    );

    return roundTo(clamp(
        score * boundedMultiplier,
        BRAND_SCORE_LIMITS.minScore,
        BRAND_SCORE_LIMITS.maxScore,
    ), 1);
}

export function adjustScoreForBrand<TItem extends BrandMappableItem>(
    item: TItem,
    baseScore: number,
    preferences: BrandPreferenceInput = {},
): BrandAdjustedScore<TItem> {
    const bias = getBrandBias(item, preferences);

    return {
        ...bias,
        baseScore: roundTo(baseScore, 1),
        adjustedScore: applyBrandMultiplier(baseScore, bias.multiplier),
    };
}

export function adjustScoresForBrand<TItem extends BrandMappableItem>(
    scoredItems: ReadonlyArray<{ item: TItem; score: number }>,
    preferences: BrandPreferenceInput = {},
): Array<BrandAdjustedScore<TItem>> {
    return scoredItems
        .map((scoredItem) => adjustScoreForBrand(scoredItem.item, scoredItem.score, preferences))
        .sort((left, right) => right.adjustedScore - left.adjustedScore);
}