import { listGearRecommendationCandidates } from "../db/gearRepository";
import { weatherFilter } from "./filters/weatherFilter";
import { categoryFilter } from "./filters/categoryFilter";
import { intensityFilter } from "./filters/intensityFilter";
import { preferenceFilter } from "./filters/preferenceFilter";
import { recommendationRanker } from "./rankers/recommendationRanker";
import { outfitBuilder } from "./builders/outfitBuilder";
import type { RecommendationGearItem, RecommendationUserInput, ScoredRecommendationItem, UserPreferenceInput } from "./types/recommendationEngine";

export type UserInput = RecommendationUserInput;
export type GearItem = RecommendationGearItem;
export type RankedGearItem = ScoredRecommendationItem;
export type GearRecommendationResult = {
  historyId?: string;
  recommendations: RankedGearItem[],
  outfits?: ReturnType<typeof outfitBuilder>;
}

export function rankGearRecommendations(userInput: RecommendationUserInput, gearItems: RecommendationGearItem[], preferences: UserPreferenceInput = {}): RankedGearItem[] {
  const filtered = preferenceFilter(preferences, intensityFilter(userInput, categoryFilter(userInput, weatherFilter(userInput, gearItems))));
  return recommendationRanker(userInput, preferences, filtered);
}

export async function generateOutfitRecommendations(userInput: RecommendationUserInput, preferences: UserPreferenceInput = {}) {
  const items = await listGearRecommendationCandidates();
  const ranked = rankGearRecommendations(userInput, items as RecommendationGearItem[], preferences);
  return { outfits: outfitBuilder(ranked), recommendations: ranked };
}