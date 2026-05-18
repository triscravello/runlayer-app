export const WEATHER_THRESHOLDS = {
    coldTempF: 45,
    coolTempF: 60,
    warmTempF: 75,
    hotTempF: 85,
    highHumidityPercent: 70,
    rainLikelyChance: 0.45,
    heavyRainChance: 0.7,
    windyMph: 15,
    veryWindyMph: 25,
} as const;

export const CONDITION_SCORING_WEIGHTS = {
    temperature: 0.38,
    precipitation: 0.24,
    wind: 0.14,
    layering: 0.12,
    categoryFit: 0.12,
} as const;

export const CATEGORY_IMPORTANCE_WEIGHTS = {
    top: 1,
    bottom: 1,
    accessory: 0.45,
} as const;

export const OUTFIT_RULES = {
    requiredCategories: ["top", "bottom"],
    optionalCategories: ["accessory"],
    maxAccessories: 2,
    maxCandidatesPerCategory: 8,
    maxOutfits: 6,
    servereRainMinimumSuitability: 0.45,
    severeWindMinimumSuitability: 0.35,
} as const;

export const LAYERING_TAGS = ["layer", "layering", "long-sleeve", "jacket", "vest", "thermal", "fleece"] as const;
export const HOT_WEATHER_TAGS = ["breathable", "lightweight", "singlet", "tank", "shorts", "quick-dry"] as const;
export const RAIN_TAGS = ["water-resistant", "waterproof", "quick-dry", "rain", "shell"] as const;
export const WIND_TAGS = ["wind", "windproof", "wind-resistant", "jacket", "shell", "vest"] as const;