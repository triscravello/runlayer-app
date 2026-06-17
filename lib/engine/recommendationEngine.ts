import { listGearRecommendationCandidates } from "../db/gearRepository";
import { weatherFilter } from "./filters/weatherFilter";
import { categoryFilter } from "./filters/categoryFilter";
import { intensityFilter } from "./filters/intensityFilter";
import { preferenceFilter } from "./filters/preferenceFilter";
import { genderFilter } from "./filters/genderFilter";
import { recommendationRanker } from "./rankers/recommendationRanker";
import { outfitBuilder } from "./builders/outfitBuilder";
import type { RecommendationGearItem, RecommendationUserInput, ScoredRecommendationItem, UserPreferenceInput } from "./types/recommendationEngine";

export type UserInput = RecommendationUserInput;
export type GearItem = RecommendationGearItem;
export type RankedGearItem = ScoredRecommendationItem;
export type GearRecommendationResult = {
  historyId?: string;
  engineVersion?: string;
  generatedAt?: string;
  recommendations: RankedGearItem[],
  outfits?: ReturnType<typeof outfitBuilder>;
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
  return { outfits: outfitBuilder(ranked), recommendations: ranked };
}