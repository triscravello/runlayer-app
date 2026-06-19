import { listGearRecommendationCandidates } from "../db/gearRepository";
import { weatherFilter } from "./filters/weatherFilter";
import { categoryFilter } from "./filters/categoryFilter";
import { intensityFilter } from "./filters/intensityFilter";
import { preferenceFilter } from "./filters/preferenceFilter";
import { genderFilter } from "./filters/genderFilter";
import { recommendationRanker } from "./rankers/recommendationRanker";
import { outfitBuilder } from "./builders/outfitBuilder";
import type { RecommendationGearItem, RecommendationUserInput, RecommendedOutfit, ScoredRecommendationItem, UserPreferenceInput } from "./types/recommendationEngine";

export type UserInput = RecommendationUserInput;
export type GearItem = RecommendationGearItem;
export type RankedGearItem = ScoredRecommendationItem;
export type GearRecommendationResult = {
  historyId?: string;
  engineVersion?: string;
  generatedAt?: string;
  recommendations: RankedGearItem[];
  recommendedOutfit?: RecommendedOutfit;
  alternatives?: RankedGearItem[];
  outfits?: ReturnType<typeof outfitBuilder>;
}

const OUTFIT_CATEGORY_ORDER = ["top", "bottom", "accessory"] as const;
const VARIANT_SUFFIX_PATTERN = /\s+(?:(?:I|II|III|IV|V|VI|VII|VIII|IX|X)|\d+)$/i;

export function baseProductKey(recommendation: ScoredRecommendationItem) {
  const brand = recommendation.item.brandName ?? recommendation.item.brandId ?? "";
  const baseName = recommendation.item.name.replace(VARIANT_SUFFIX_PATTERN, "").trim().toLowerCase();

  return `${brand.toLowerCase()}::${baseName}`;
}

export function suppressDuplicateProductFamilies(rankedItems: ScoredRecommendationItem[]) {
  const bestByProductFamily = new Map<string, ScoredRecommendationItem>();

  for (const item of rankedItems) {
    const productKey = baseProductKey(item);
    const current = bestByProductFamily.get(productKey);

    if (!current || item.totalScore > current.totalScore) {
      bestByProductFamily.set(productKey, item);
    }
  }

  return Array.from(bestByProductFamily.values()).sort((a, b) => b.totalScore - a.totalScore);
}

export function buildRecommendedOutfit(rankedItems: ScoredRecommendationItem[]): RecommendedOutfit | undefined {
  const top = rankedItems.find((item) => item.item?.category?.toLowerCase() === "top");
  const bottom = rankedItems.find((item) => item.item?.category?.toLowerCase() === "bottom");
  const accessory = rankedItems.find((item) => item.item?.category?.toLowerCase() === "accessory");

  if (!top && !bottom && !accessory) return undefined;

  return { top, bottom, accessory };
}

export function diversifyRecommendationsByCategory(rankedItems: ScoredRecommendationItem[], limit: number) {
  const uniqueItems = suppressDuplicateProductFamilies(rankedItems);
  const selected: ScoredRecommendationItem[] = [];
  const usedIds = new Set<string>();

  const addItem = (item?: ScoredRecommendationItem) => {
    if (!item || usedIds.has(item.item.id) || selected.length >= limit) return;
    selected.push(item);
    usedIds.add(item.item.id);
  };

  for (const category of OUTFIT_CATEGORY_ORDER) {
    addItem(uniqueItems.find((item) => item.item.category?.toLowerCase() === category));
  }

  for (const item of uniqueItems) {
    addItem(item);
  }
  
  return selected;
}

export function rankGearRecommendations(userInput: RecommendationUserInput, gearItems: RecommendationGearItem[], preferences: UserPreferenceInput = {}): RankedGearItem[] {
  const afterWeather = weatherFilter(userInput, gearItems);
  const afterCategory = categoryFilter(userInput, afterWeather);
  const afterIntensity = intensityFilter(userInput, afterCategory);
  const afterPreference = preferenceFilter(preferences, afterIntensity);
  const afterGender = genderFilter(preferences, afterPreference);
  const ranked = recommendationRanker(userInput, preferences, afterGender);
  
  return ranked;
}

export async function generateOutfitRecommendations(userInput: RecommendationUserInput, preferences: UserPreferenceInput = {}) {
  const items = await listGearRecommendationCandidates();
  const ranked = rankGearRecommendations(userInput, items as RecommendationGearItem[], preferences);
  const recommendations = diversifyRecommendationsByCategory(ranked, 5);
  return {
    recommendedOutfit: buildRecommendedOutfit(recommendations),
    alternatives: recommendations.filter((item) => !OUTFIT_CATEGORY_ORDER.includes(item.item.category?.toLowerCase() as typeof OUTFIT_CATEGORY_ORDER[number])),
    outfits: outfitBuilder(recommendations),
    recommendations,
  };
}