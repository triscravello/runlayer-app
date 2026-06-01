export type WeatherCondition = "hot" | "cold" | "rain" | "humid" | "wind";
export type Intensity = "recovery" | "easy" | "long-run" | "tempo" | "race";
export type Terrain = "road" | "trail" | "treadmill";
export type Season = "winter" | "summer" | "shoulder";
export type Category = "top" | "bottom" | "accessory" | "outerwear" | "socks" | "hat" | "gloves";
export type RecommendationUserInput = { userId?: string; weather?: WeatherCondition; intensity?: Intensity, workoutType?: string, terrain?: Terrain; category?: Category | "all"; };
export type UserPreferenceInput = { favoriteBrands?: string[]; preferredBrands?: string[]; avoidedBrands?: string[]; budgetRange?: "budget" | "mid" | "premium"; cushionPreference?: "minimalist" | "max-cushion"; recentRecommendedItemIds?: string[]; frequentlySavedItemIds?: string[]; season?: Season; };
export type RecommendationGearItem = { id: string; name: string; brandId?: string | null; category?: string | null; priceRange?: string | null; tags: string[]; weatherSuitability: Partial<Record<WeatherCondition, number>> | null; };
export type RecommendationScoreBreakdown = {
  weather: number;
  intensity: number;
  terrain: number;
  seasonality: number;
  brandAffinity: number;
  rotationAdjustment: number;
};
export type ScoredRecommendationItem = {
  item: RecommendationGearItem;
  score: number;
  totalScore: number;
  scoreBreakdown: RecommendationScoreBreakdown;
  breakdown: RecommendationScoreBreakdown;
  reasons: string[];
  contributions: RecommendationScoreBreakdown;
  recommendationId?: string;
};