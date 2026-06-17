import type { RecommendationGearItem, RecommendationUserInput } from "../types/recommendationEngine";
export function categoryFilter(
  userInput: RecommendationUserInput,
  gearItems: RecommendationGearItem[]
) {
  console.log("Category filter input:", userInput.category);

  if (!userInput.category || userInput.category === "all") {
    return gearItems;
  }

  const filtered = gearItems.filter(
    (i) => i.category?.toLowerCase() === userInput.category?.toLowerCase()
  );

  console.log("Category filter result:", filtered.length);

  return filtered;
}