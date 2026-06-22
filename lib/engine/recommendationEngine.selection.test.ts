import assert from "node:assert/strict";
import test from "node:test";
import { buildAlternativesByCategory, buildRecommendedOutfit, diversifyRecommendationsByCategory, getRecommendationCategoryDiagnostics, getRecommendationSelectionDiagnostics, logRecommendationSelectionDiagnostics } from "./recommendationEngine";
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

test("logRecommendationSelectionDiagnostics reports category counts and loss stages", () => {
  const rankedItems = [
    scoredItem("top-1", "EZ Tee Perf I", "TOP", 10),
    scoredItem("bottom-1", "AFO Split Short Ultra I", "BOTTOM", 9),
    scoredItem("accessory-1", "SpeedDraw Flask I", "ACCESSORY", 8),
    scoredItem("accessory-2", "ATC Performance Running Cap I", "ACCESSORY", 7),
  ];
  const outfitCandidates = [rankedItems[0], rankedItems[2]];
  const recommendedOutfit = buildRecommendedOutfit(outfitCandidates);
  const alternativesByCategory = buildAlternativesByCategory(rankedItems, recommendedOutfit);
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));

  try {
    logRecommendationSelectionDiagnostics(rankedItems, outfitCandidates, recommendedOutfit, alternativesByCategory);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(logs.slice(0, 8), [
    "Ranked:",
    "top=1 bottom=1 accessory=2",
    "Outfit candidates:",
    "top=1 bottom=0 accessory=1",
    "Recommended outfit:",
    "top=true bottom=false accessory=true",
    "Alternatives:",
    "top=0 bottom=1 accessory=1",
  ]);
  assert.ok(logs.includes("bottom lost between ranked items and outfit candidates"));
});

test("buildAlternativesByCategory returns category-specific non-duplicate family swaps", () => {
  const rankedItems = [
    scoredItem("top-1", "EZ Tee Perf I", "TOP", 10),
    scoredItem("top-2", "EZ Tee Perf II", "TOP", 9),
    scoredItem("top-3", "Session Tee", "TOP", 8),
    scoredItem("bottom-1", "AFO Split Short Ultra I", "BOTTOM", 7),
    scoredItem("bottom-2", "Hawaiian Split Shorts I", "BOTTOM", 6),
    scoredItem("accessory-1", "SpeedDraw Flask I", "ACCESSORY", 5),
    scoredItem("accessory-2", "ATC Performance Running Cap I", "ACCESSORY", 4),
  ];
  const recommendedOutfit = buildRecommendedOutfit(diversifyRecommendationsByCategory(rankedItems, 3));

  const alternativesByCategory = buildAlternativesByCategory(rankedItems, recommendedOutfit);

  assert.deepEqual(alternativesByCategory.top.map((item) => item.item.id), ["top-3"]);
  assert.deepEqual(alternativesByCategory.bottom.map((item) => item.item.id), ["bottom-2"]);
  assert.deepEqual(alternativesByCategory.accessory.map((item) => item.item.id), ["accessory-2"]);
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
test("development category diagnostics count filter stages and ranked top 10 without console output", () => {
  const originalRecommendationDebug = process.env.RECOMMENDATION_DEBUG;
  process.env.RECOMMENDATION_DEBUG = "true";
  const restoreRecommendationDebug = () => {
    if (originalRecommendationDebug === undefined) {
        delete process.env.RECOMMENDATION_DEBUG;
    } else {
        process.env.RECOMMENDATION_DEBUG = originalRecommendationDebug;
    }
  };
  const originalLog = console.log;
  const logs: unknown[][] = [];
  console.log = (...args: unknown[]) => logs.push(args);

  try {
    const gearItems = [
      scoredItem("top-1", "Fast Top", "TOP", 0).item,
      scoredItem("bottom-1", "Fast Bottom", "BOTTOM", 0).item,
      scoredItem("accessory-1", "Fast Hat", "ACCESSORY", 0).item,
      scoredItem("bottom-2", "Budget Bottom", "BOTTOM", 0).item,
    ].map((item, index) => ({
      ...item,
      priceRange: index === 3 ? "budget" : "mid",
      tags: ["tempo"],
      weatherSuitability: { hot: 0.8 },
    }));

    const { ranked, diagnostics } = getRecommendationCategoryDiagnostics(
      { weather: "hot", intensity: "tempo" },
      gearItems,
      { budgetRange: "mid" },
    );

    assert.equal(ranked.length, 4);
    assert.deepEqual(diagnostics?.weather, { TOP: 1, BOTTOM: 2, ACCESSORY: 1 });
    assert.deepEqual(diagnostics?.category, { TOP: 1, BOTTOM: 2, ACCESSORY: 1 });
    assert.deepEqual(diagnostics?.intensity, { TOP: 1, BOTTOM: 2, ACCESSORY: 1 });
    assert.deepEqual(diagnostics?.preference, { TOP: 1, BOTTOM: 2, ACCESSORY: 1 });
    assert.deepEqual(diagnostics?.gender, { TOP: 1, BOTTOM: 2, ACCESSORY: 1 });
    assert.deepEqual(diagnostics?.ranking, { TOP: 1, BOTTOM: 2, ACCESSORY: 1 });
    assert.equal(diagnostics?.rankedTop10.length, 4);
    assert.equal(logs.length, 0);
  } finally {
    console.log = originalLog;
    restoreRecommendationDebug();
  }
});

test("intensity filtering preserves outfit categories when an intensity tag misses a category", () => {
  const originalRecommendationDebug = process.env.RECOMMENDATION_DEBUG;
  process.env.RECOMMENDATION_DEBUG = "true";
  const restoreRecommendationDebug = () => {
    if (originalRecommendationDebug === undefined) {
        delete process.env.RECOMMENDATION_DEBUG;
    } else {
        process.env.RECOMMENDATION_DEBUG = originalRecommendationDebug;
    }
  }

  const originalLog = console.log;
  console.log = () => {};

  try {
    const gearItems = [
      {
        ...scoredItem("top-easy", "Easy Top", "TOP", 0).item,
        tags: ["easy"],
        weatherSuitability: { hot: 0.8 },
      },
      {
        ...scoredItem("bottom-general", "General Bottom", "BOTTOM", 0).item,
        tags: ["quick-dry"],
        weatherSuitability: { hot: 0.8 },
      },
      {
        ...scoredItem("accessory-easy", "Easy Hat", "ACCESSORY", 0).item,
        tags: ["easy"],
        weatherSuitability: { hot: 0.8 },
      },
    ];

    const { ranked, diagnostics } = getRecommendationCategoryDiagnostics(
      { weather: "hot", intensity: "easy" },
      gearItems,
    );
    const recommendations = diversifyRecommendationsByCategory(ranked, 5);
    const recommendedOutfit = buildRecommendedOutfit(recommendations);

    assert.deepEqual(diagnostics?.category, { TOP: 1, BOTTOM: 1, ACCESSORY: 1 });
    assert.deepEqual(diagnostics?.intensity, { TOP: 1, BOTTOM: 1, ACCESSORY: 1 });
    assert.ok(recommendedOutfit?.top);
    assert.ok(recommendedOutfit?.bottom);
    assert.ok(recommendedOutfit?.accessory);
    assert.equal(recommendedOutfit.bottom.item.id, "bottom-general");
    assert.equal(recommendedOutfit.top.scoreBreakdown.intensity, 10);
    assert.equal(recommendedOutfit.bottom.scoreBreakdown.intensity, 0);
  } finally {
    console.log = originalLog;
    restoreRecommendationDebug();
  }
});

test("weather filtering preserves essential outfit categories when suitability removes all bottoms", () => {
  const originalRecommendationDebug = process.env.RECOMMENDATION_DEBUG;
  process.env.RECOMMENDATION_DEBUG = "true";
  const restoreRecommendationDebug = () => {
    if (originalRecommendationDebug === undefined) {
        delete process.env.RECOMMENDATION_DEBUG;
    } else {
        process.env.RECOMMENDATION_DEBUG = originalRecommendationDebug;
    }
  }

  const originalLog = console.log;
  console.log = () => {};

  try {
    const gearItems = [
      {
        ...scoredItem("top-warm", "Warm Top", "TOP", 0).item,
        tags: ["easy"],
        weatherSuitability: { warm: 0.8 },
      },
      {
        ...scoredItem("bottom-low", "Low Suitability Bottom", "BOTTOM", 0).item,
        tags: ["easy"],
        weatherSuitability: { warm: 0.2 },
      },
      {
        ...scoredItem("bottom-best", "Best Available Bottom", "bottom", 0).item,
        tags: ["easy"],
        weatherSuitability: { warm: 0.3 },
      },
      {
        ...scoredItem("accessory-warm", "Warm Hat", "ACCESSORY", 0).item,
        tags: ["easy"],
        weatherSuitability: { warm: 0.7 },
      },
    ];

    const { ranked, diagnostics } = getRecommendationCategoryDiagnostics(
      { weather: "warm", intensity: "easy" },
      gearItems,
    );
    const recommendations = diversifyRecommendationsByCategory(ranked, 5);
    const recommendedOutfit = buildRecommendedOutfit(recommendations);

    assert.deepEqual(diagnostics?.weather, { TOP: 1, BOTTOM: 1, ACCESSORY: 1 });
    assert.ok(recommendedOutfit?.top);
    assert.ok(recommendedOutfit?.bottom);
    assert.ok(recommendedOutfit?.accessory);
    assert.equal(recommendedOutfit.bottom.item.id, "bottom-best");
    assert.equal(recommendedOutfit.bottom.scoreBreakdown.weather, 4);
  } finally {
    console.log = originalLog;
    restoreRecommendationDebug();
  }
});

test("budget and preferred brand mismatches do not remove eligible bottoms", () => {
  const originalRecommendationDebug = process.env.RECOMMENDATION_DEBUG;
  process.env.RECOMMENDATION_DEBUG = "true";
  const restoreRecommendationDebug = () => {
    if (originalRecommendationDebug === undefined) {
        delete process.env.RECOMMENDATION_DEBUG;
    } else {
        process.env.RECOMMENDATION_DEBUG = originalRecommendationDebug;
    }
  };

  try {
    const gearItems = [
      {
        ...scoredItem("top-mid-favorite", "Favorite Top", "TOP", 0).item,
        brandName: "Preferred Brand",
        genderTarget: "men",
        priceRange: "mid",
        tags: ["tempo"],
        weatherSuitability: { hot: 0.8 },
      },
      {
        ...scoredItem("bottom-premium-other", "Premium Other Bottom", "BOTTOM", 0).item,
        brandName: "Other Brand",
        genderTarget: "men",
        priceRange: "premium",
        tags: ["tempo"],
        weatherSuitability: { hot: 0.8 },
      },
      {
        ...scoredItem("accessory-budget-other", "Budget Other Hat", "ACCESSORY", 0).item,
        brandName: "Other Brand",
        genderTarget: "unisex",
        priceRange: "budget",
        tags: ["tempo"],
        weatherSuitability: { hot: 0.8 },
      },
    ];

    const { ranked, diagnostics } = getRecommendationCategoryDiagnostics(
      { weather: "hot", intensity: "tempo" },
      gearItems,
      { budgetRange: "mid", genderPreference: "male", preferredBrands: ["Preferred Brand"] },
    );
    const recommendations = diversifyRecommendationsByCategory(ranked, 5);
    const recommendedOutfit = buildRecommendedOutfit(recommendations);

    assert.deepEqual(diagnostics?.preference, { TOP: 1, BOTTOM: 1, ACCESSORY: 1 });
    assert.deepEqual(diagnostics?.gender, { TOP: 1, BOTTOM: 1, ACCESSORY: 1 });
    assert.ok(recommendedOutfit?.top);
    assert.ok(recommendedOutfit?.bottom);
    assert.ok(recommendedOutfit?.accessory);
    assert.equal(recommendedOutfit.bottom.item.id, "bottom-premium-other");
    assert.ok(recommendedOutfit.bottom.scoreBreakdown.budget < 0);
    assert.equal(recommendedOutfit.bottom.scoreBreakdown.brandAffinity, 0);
  } finally {
    restoreRecommendationDebug();
  }
});