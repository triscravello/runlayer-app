import { listGearRecommendationCandidates } from "../db/gearRepository";
import { weatherFilter } from "./filters/weatherFilter";
import { categoryFilter } from "./filters/categoryFilter";
import { intensityFilter } from "./filters/intensityFilter";
import { preferenceFilter } from "./filters/preferenceFilter";
import { genderFilter } from "./filters/genderFilter";
import { recommendationRanker } from "./rankers/recommendationRanker";
import { outfitBuilder } from "./builders/outfitBuilder";
import type { AlternativesByCategory, RecommendationCategoryDiagnostics, RecommendationCategoryDiagnosticsCounts, RecommendationCategoryDiagnosticsRankedItem, RecommendationGearItem, RecommendationUserInput, RecommendedOutfit, ScoredRecommendationItem, UserPreferenceInput } from "./types/recommendationEngine";

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
  alternativesByCategory?: AlternativesByCategory;
  outfits?: ReturnType<typeof outfitBuilder>;
  diagnostics?: RecommendationCategoryDiagnostics;
}

const OUTFIT_CATEGORY_ORDER = ["top", "bottom", "accessory"] as const;
const ALTERNATIVE_CATEGORY_ORDER = ["top", "bottom", "accessory"] as const;
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

export function buildAlternativesByCategory(
  rankedItems: ScoredRecommendationItem[],
  recommendedOutfit: RecommendedOutfit | undefined,
  perCategoryLimit = 3,
): AlternativesByCategory {
  const selectedItems = Object.values(recommendedOutfit ?? {}).filter((item): item is ScoredRecommendationItem => Boolean(item));
  const selectedIds = new Set(selectedItems.map((item) => item.item.id));
  const selectedFamilies = new Set(selectedItems.map(baseProductKey));
  const alternativesByCategory: AlternativesByCategory = { top: [], bottom: [], accessory: [] };

  for (const category of ALTERNATIVE_CATEGORY_ORDER) {
    const usedFamilies = new Set(selectedFamilies);
    const categoryAlternatives: ScoredRecommendationItem[] = [];

    for (const recommendation of rankedItems) {
      if (categoryAlternatives.length >= perCategoryLimit) break;
      if (normalizeCategory(recommendation.item.category) !== category) continue;
      if (selectedIds.has(recommendation.item.id)) continue;

      const productFamily = baseProductKey(recommendation);
      if (usedFamilies.has(productFamily)) continue;

      categoryAlternatives.push(recommendation);
      usedFamilies.add(productFamily);
    }

    alternativesByCategory[category] = categoryAlternatives;
  }

  return alternativesByCategory;
}

export function flattenAlternativesByCategory(alternativesByCategory: AlternativesByCategory) {
  return ALTERNATIVE_CATEGORY_ORDER.flatMap((category) => alternativesByCategory[category] ?? []);
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

function countScoredRecommendationsByCategory(items: ScoredRecommendationItem[]) {
  return OUTFIT_CATEGORY_ORDER.reduce<Record<typeof OUTFIT_CATEGORY_ORDER[number], number>>((counts, category) => {
    counts[category] = items.filter((item) => normalizeCategory(item.item.category) === category).length;
    return counts;
  }, { top: 0, bottom: 0, accessory: 0 });
}

function countAlternativesByCategory(alternativesByCategory: AlternativesByCategory) {
  return OUTFIT_CATEGORY_ORDER.reduce<Record<typeof OUTFIT_CATEGORY_ORDER[number], number>>((counts, category) => {
    counts[category] = alternativesByCategory[category]?.length ?? 0;
    return counts;
  }, { top: 0, bottom: 0, accessory: 0 });
}

function formatCategoryCounts(counts: Record<typeof OUTFIT_CATEGORY_ORDER[number], number>) {
  return OUTFIT_CATEGORY_ORDER.map((category) => `${category}=${counts[category]}`).join(" ");
}

function formatRecommendedOutfitCategories(recommendedOutfit: RecommendedOutfit | undefined) {
  return OUTFIT_CATEGORY_ORDER.map((category) => `${category}=${Boolean(recommendedOutfit?.[category])}`).join(" ");
}

export function logRecommendationSelectionDiagnostics(
  rankedItems: ScoredRecommendationItem[],
  outfitCandidates: ScoredRecommendationItem[],
  recommendedOutfit: RecommendedOutfit | undefined,
  alternativesByCategory: AlternativesByCategory,
) {
  const rankedCounts = countScoredRecommendationsByCategory(rankedItems);
  const outfitCandidateCounts = countScoredRecommendationsByCategory(outfitCandidates);
  const alternativeCounts = countAlternativesByCategory(alternativesByCategory);

  console.log("Ranked:");
  console.log(formatCategoryCounts(rankedCounts));
  console.log("Outfit candidates:");
  console.log(formatCategoryCounts(outfitCandidateCounts));
  console.log("Recommended outfit:");
  console.log(formatRecommendedOutfitCategories(recommendedOutfit));
  console.log("Alternatives:");
  console.log(formatCategoryCounts(alternativeCounts));

  for (const category of OUTFIT_CATEGORY_ORDER) {
    if (rankedCounts[category] > 0 && outfitCandidateCounts[category] === 0) {
      console.log(`${category} lost between ranked items and outfit candidates`);
    } else if (outfitCandidateCounts[category] > 0 && !recommendedOutfit?.[category]) {
      console.log(`${category} lost between outfit candidates and recommended outfit`);
    }
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

  return {
    ranked,
    diagnostics: {
      weather: getCategoryDiagnosticsCounts(afterWeather),
      category: getCategoryDiagnosticsCounts(afterCategory),
      intensity: getCategoryDiagnosticsCounts(afterIntensity),
      preference: getCategoryDiagnosticsCounts(afterPreference),
      gender: getCategoryDiagnosticsCounts(afterGender),
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
  const outfitCandidates = diversifyRecommendationsByCategory(ranked, 5);
  const recommendedOutfit = buildRecommendedOutfit(outfitCandidates);
  const alternativesByCategory = buildAlternativesByCategory(ranked, recommendedOutfit);
  const alternatives = flattenAlternativesByCategory(alternativesByCategory);
  logRecommendationSelectionDiagnostics(ranked, outfitCandidates, recommendedOutfit, alternativesByCategory);
  const recommendations = [...outfitCandidates, ...alternatives.filter((alternative) => !outfitCandidates.some((item) => item.item.id === alternative.item.id))];

  return {
    recommendedOutfit,
    alternativesByCategory,
    alternatives,
    outfits: outfitBuilder(recommendations),
    recommendations,
    ...(diagnostics ? { diagnostics }: {}),
  };
}