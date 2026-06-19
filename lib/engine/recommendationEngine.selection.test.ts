import assert from "node:assert/strict";
import test from "node:test";
import { buildRecommendedOutfit, diversifyRecommendationsByCategory, getRecommendationSelectionDiagnostics } from "./recommendationEngine";
import type { RecommendationScoreBreakdown, ScoredRecommendationItem } from "./types/recommendationEngine";

const emptyBreakdown: RecommendationScoreBreakdown = {
  weather: 0,
  intensity: 0,
  terrain: 0,
  seasonality: 0,
  brandAffinity: 0,
  brandPenalty: 0,
  budget: 0,
  genderAlignment: 0,
  temperatureTolerance: 0,
  rotationAdjustment: 0,
};

function scoredItem(id: string, name: string, category: string, totalScore: number): ScoredRecommendationItem {
  return {
    item: {
      id,
      name,
      brandName: "Test Brand",
      category,
      tags: [],
      weatherSuitability: {},
    },
    score: totalScore,
    totalScore,
    scoreBreakdown: emptyBreakdown,
    breakdown: emptyBreakdown,
    reasons: [],
    contributions: emptyBreakdown,
  };
}

test("diversifyRecommendationsByCategory keeps top, bottom, and accessory with normalized categories", () => {
  const rankedItems = [
    scoredItem("top-1", "EZ Tee Perf I", "TOP", 10),
    scoredItem("accessory-1", "SpeedDraw Flask I", "ACCESSORY", 9),
    scoredItem("bottom-1", "AFO Split Short Ultra I", "BOTTOM", 8),
    scoredItem("top-2", "EZ Tee Perf II", "TOP", 7),
    scoredItem("bottom-2", "Hawaiian Split Shorts I", "BOTTOM", 6),
    scoredItem("accessory-2", "ATC Performance Running Cap I", "ACCESSORY", 5),
  ];

  const selectedItems = diversifyRecommendationsByCategory(rankedItems, 5);
  const recommendedOutfit = buildRecommendedOutfit(selectedItems);
  const diagnostics = getRecommendationSelectionDiagnostics(rankedItems, selectedItems);

  assert.equal(selectedItems.length, 5);
  assert.equal(recommendedOutfit?.top?.item.id, "top-1");
  assert.equal(recommendedOutfit?.bottom?.item.id, "bottom-1");
  assert.equal(recommendedOutfit?.accessory?.item.id, "accessory-1");
  assert.equal(diagnostics.selectedCategoryCounts.bottom, 2);
});

test("diversifyRecommendationsByCategory only relaxes duplicate-family suppression after better alternatives are used", () => {
  const rankedItems = [
    scoredItem("top-1", "EZ Tee Perf I", "TOP", 10),
    scoredItem("top-2", "EZ Tee Perf II", "TOP", 9),
    scoredItem("bottom-1", "AFO Split Short Ultra I", "BOTTOM", 8),
    scoredItem("accessory-1", "SpeedDraw Flask I", "ACCESSORY", 7),
    scoredItem("accessory-2", "ATC Performance Running Cap I", "ACCESSORY", 6),
  ];

  const selectedItems = diversifyRecommendationsByCategory(rankedItems, 5);

  assert.deepEqual(
    selectedItems.map((item) => item.item.id),
    ["top-1", "bottom-1", "accessory-1", "accessory-2", "top-2"],
  );
});

test("outfit contains one top, one bottom, and one accessory when all categories are available", () => {
  const rankedItems = [
    scoredItem("top-1", "EZ Tee Perf I", "TOP", 10),
    scoredItem("accessory-1", "SpeedDraw 2 Insulated Flask 12oz I", "ACCESSORY", 9),
    scoredItem("bottom-1", "AFO Split Short Ultra I", "BOTTOM", 8),
    scoredItem("top-2", "Dri-FIT ADV Aeroswift Singlet I", "TOP", 7),
    scoredItem("bottom-2", "Hawaiian Split Shorts I", "BOTTOM", 6),
  ];

  const selectedItems = diversifyRecommendationsByCategory(rankedItems, 5);
  const recommendedOutfit = buildRecommendedOutfit(selectedItems);

  assert.ok(recommendedOutfit?.top);
  assert.ok(recommendedOutfit?.bottom);
  assert.ok(recommendedOutfit?.accessory);
  assert.equal(recommendedOutfit.top.item.category?.toLowerCase(), "top");
  assert.equal(recommendedOutfit.bottom.item.category?.toLowerCase(), "bottom");
  assert.equal(recommendedOutfit.accessory.item.category?.toLowerCase(), "accessory");
});