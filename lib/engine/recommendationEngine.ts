import { listGearRecommendationCandidates } from "../db/gearRepository";
import { weatherFilter } from "./filters/weatherFilter";
import { categoryFilter } from "./filters/categoryFilter";
import { intensityFilter } from "./filters/intensityFilter";
import { preferenceFilter } from "./filters/preferenceFilter";
import { genderFilter } from "./filters/genderFilter";
import { recommendationRanker } from "./rankers/recommendationRanker";
import { outfitBuilder } from "./builders/outfitBuilder";
import type { RecommendationCategoryDiagnostics, RecommendationCategoryDiagnosticsCounts, RecommendationCategoryDiagnosticsRankedItem, RecommendationGearItem, RecommendationUserInput, RecommendedOutfit, ScoredRecommendationItem, UserPreferenceInput } from "./types/recommendationEngine";

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
  diagnostics?: RecommendationCategoryDiagnostics;
}

const OUTFIT_CATEGORY_ORDER = ["top", "bottom", "accessory"] as const;
const VARIANT_SUFFIX_PATTERN = /\s+(?:(?:I|II|III|IV|V|VI|VII|VIII|IX|X)|\d+)$/i;

function normalizeCategory(category?: string | null) {
  return category?.trim().toLowerCase() ?? "";
}

export function baseProductKey(recommendation: ScoredRecommendationItem) {
  const brand = recommendation.item.brandName ?? recommendation.item.brandId ?? "";
  const category = normalizeCategory(recommendation.item.category);
  const baseName = recommendation.item.name.replace(VARIANT_SUFFIX_PATTERN, "").trim().toLowerCase();

  return `${brand.toLowerCase()}::${category}::${baseName}`;
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
  const top = rankedItems.find((item) => normalizeCategory(item.item?.category) === "top");
  const bottom = rankedItems.find((item) => normalizeCategory(item.item?.category) === "bottom");
  const accessory = rankedItems.find((item) => normalizeCategory(item.item?.category) === "accessory");

  if (!top && !bottom && !accessory) return undefined;

  return { top, bottom, accessory };
}


function getCategoryDiagnosticsCounts(items: Array<RecommendationGearItem | ScoredRecommendationItem>): RecommendationCategoryDiagnosticsCounts {
  const counts: RecommendationCategoryDiagnosticsCounts = { TOP: 0, BOTTOM: 0, ACCESSORY: 0 };

  for (const entry of items) {
    const item = "item" in entry ? entry.item : entry;
    const category = normalizeCategory(item.category).toUpperCase();

    if (category === "TOP" || category === "BOTTOM" || category === "ACCESSORY") {
      counts[category] += 1;
    }
  }

  return counts;
}

function isRecommendationDebugEnabled() {
  return process.env.RECOMMENDATION_DEBUG === "true" || process.env.NODE_ENV === "development";
}

function toRankedDiagnosticsItem(recommendation: ScoredRecommendationItem) {
  return {
    category: recommendation.item.category,
    name: recommendation.item.name,
    score: recommendation.totalScore,
  };
}

function logTopRankedItemsByCategory(rankedItems: ScoredRecommendationItem[]) {
  if (!isRecommendationDebugEnabled()) return;

  for (const category of OUTFIT_CATEGORY_ORDER) {
    const topItems = rankedItems
      .filter((item) => normalizeCategory(item.item.category) === category)
      .slice(0, 5)
      .map(toRankedDiagnosticsItem);

    console.log(`[recommendation diagnostics] Top ${topItems.length} ${category.toUpperCase()} items by score`, topItems);
  }
}

export function getRecommendationCategoryDiagnostics(
  userInput: RecommendationUserInput,
  gearItems: RecommendationGearItem[],
  preferences: UserPreferenceInput = {},
): { ranked: RankedGearItem[]; diagnostics?: RecommendationCategoryDiagnostics } {
  const afterWeather = weatherFilter(userInput, gearItems);
  const afterCategory = categoryFilter(userInput, afterWeather);
  const afterIntensity = intensityFilter(userInput, afterCategory);
  const afterPreference = preferenceFilter(preferences, afterIntensity);
  const afterGender = genderFilter(preferences, afterPreference);
  const ranked = recommendationRanker(userInput, preferences, afterGender);

  if (!isRecommendationDebugEnabled()) {
    return { ranked };
  }

  logTopRankedItemsByCategory(ranked);

  return {
    ranked,
    diagnostics: {
      weather: getCategoryDiagnosticsCounts(afterWeather),
      category: getCategoryDiagnosticsCounts(afterCategory),
      intensity: getCategoryDiagnosticsCounts(afterIntensity),
      preference: getCategoryDiagnosticsCounts(afterPreference),
      ranking: getCategoryDiagnosticsCounts(ranked),
      rankedTop10: ranked.slice(0, 10).map(toRankedDiagnosticsItem),
    },
  };
}

export function getRecommendationSelectionDiagnostics(rankedItems: ScoredRecommendationItem[], selectedItems: ScoredRecommendationItem[]) {
  const rankedCategoryCounts = rankedItems.reduce<Record<string, number>>((counts, item) => {
    const category = normalizeCategory(item.item.category) || "unknown";
    counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {});
  const selectedCategoryCounts = selectedItems.reduce<Record<string, number>>((counts, item) => {
    const category = normalizeCategory(item.item.category) || "unknown";
    counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {});

  return {
    rankedCount: rankedItems.length,
    selectedCount: selectedItems.length,
    rankedCategoryCounts,
    selectedCategoryCounts,
    duplicateFamilyCount: rankedItems.length - suppressDuplicateProductFamilies(rankedItems).length,
  };
}

export function diversifyRecommendationsByCategory(rankedItems: ScoredRecommendationItem[], limit: number) {
  if (limit <= 0) return [];

  const uniqueItems = suppressDuplicateProductFamilies(rankedItems);
  const selected: ScoredRecommendationItem[] = [];
  const usedIds = new Set<string>();
  const usedProductFamilies = new Set<string>();

  const addItem = (item?: ScoredRecommendationItem, options: { allowDuplicateFamily?: boolean } = {}) => {
    if (!item || usedIds.has(item.item.id) || selected.length >= limit) return;
    const productFamily = baseProductKey(item);
    if (!options.allowDuplicateFamily && usedProductFamilies.has(productFamily)) return;

    selected.push(item);
    usedIds.add(item.item.id);
    usedProductFamilies.add(productFamily);
  };

  for (const category of OUTFIT_CATEGORY_ORDER) {
    addItem(uniqueItems.find((item) => normalizeCategory(item.item.category) === category));
  }

  for (const item of uniqueItems) {
    addItem(item);
  }

  for (const item of rankedItems) {
    addItem(item, { allowDuplicateFamily: true });
  }
  
  return selected;
}

export function rankGearRecommendations(userInput: RecommendationUserInput, gearItems: RecommendationGearItem[], preferences: UserPreferenceInput = {}): RankedGearItem[] {
  return getRecommendationCategoryDiagnostics(userInput, gearItems, preferences).ranked;
}

export async function generateOutfitRecommendations(userInput: RecommendationUserInput, preferences: UserPreferenceInput = {}) {
  const items = await listGearRecommendationCandidates();
  const { ranked, diagnostics } = getRecommendationCategoryDiagnostics(userInput, items as RecommendationGearItem[], preferences);
  const recommendations = diversifyRecommendationsByCategory(ranked, 5);
  return {
    recommendedOutfit: buildRecommendedOutfit(recommendations),
    alternatives: recommendations.filter((item) => !OUTFIT_CATEGORY_ORDER.includes(normalizeCategory(item.item.category) as typeof OUTFIT_CATEGORY_ORDER[number])),
    outfits: outfitBuilder(recommendations),
    recommendations,
    ...(diagnostics ? { diagnostics }: {}),
  };
}