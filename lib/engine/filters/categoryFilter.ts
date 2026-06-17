import type { RecommendationGearItem, RecommendationUserInput } from "../types/recommendationEngine";
export function categoryFilter(
  userInput: RecommendationUserInput,
  gearItems: RecommendationGearItem[]
) {
  if (!userInput.category || userInput.category === "all") {
    return gearItems;
  }

  const filtered = gearItems.filter(
    (i) => i.category?.toLowerCase() === userInput.category?.toLowerCase()
  );

  return filtered;
}