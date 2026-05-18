import {
    CATEGORY_IMPORTANCE_WEIGHTS,
    CONDITION_SCORING_WEIGHTS,
    HOT_WEATHER_TAGS,
    LAYERING_TAGS,
    RAIN_TAGS,
    WEATHER_THRESHOLDS,
    WIND_TAGS,
} from "@/config/scoring";
import { clamp, roundTo, weightedSum } from "../utils/math";
import { normalizeText, normalizeToken, titleCase } from "../utils/text";

export type WeatherInput = {
    temperature?: number | null;
    tempF?: number | null;
    humidity?: number | null;
    windSpeed?: number | null;
    precipitationChance?: number | null;
    condition?: string | null;
    tempCategory?: string | null;
};

export type ConditionScoreableGearItem = {
    id?: string;
    name?: string;
    category?: string | null;
    subcategory?: string | null;
    tags?: string[] | null;
    weatherSuitability?: Record<string, number | null | undefined> | null;
    weatherHot?: number | null;
    weatherCold?: number | null;
    weatherRain?: number | null;
    weatherWind?: number | null;
};

export type ScoreBreakdownKey = keyof typeof CONDITION_SCORING_WEIGHTS;

export type ScoreContribution = {
    key: ScoreBreakdownKey,
    score: number;
    weight: number;
    weightedScore: number;
}

export type ConditionScoreResult<TItem extends ConditionScoreableGearItem = ConditionScoreableGearItem> = {
    item: TItem;
    score: number;
    normalizedScore: number;
    breakdown: ScoreContribution[];
    explanation: string[];
};

function getTemperature(weather: WeatherInput): number | null {
    return weather.temperature ?? weather.tempF ?? null;
}

function getSuitability(item: ConditionScoreableGearItem, key: string, fallback = 0.5): number {
    const suitability = item.weatherSuitability?.[key];

    if (typeof suitability === "number") {
        return clamp(suitability);
    }

    const denormalizedKey = `weather${titleCase(key).replace(/\s/g, "")}` as keyof ConditionScoreableGearItem;
    const denormalizedValue = item[denormalizedKey];

    return typeof denormalizedValue === "number" ? clamp(denormalizedValue) : fallback;
}

function hasAnyTag(item: ConditionScoreableGearItem, tags: readonly string[]) {
    const itemTags = (item.tags ?? []).map(normalizeToken);
    return tags.some((tag) => itemTags.some((itemTag) => itemTag.includes(normalizeToken(tag))));
}

function getTemperatureCondition(weather: WeatherInput): "hot" | "warm" | "mild" | "cool" | "cold" {
    const explicitCategory = normalizeText(weather.tempCategory);

    if (["hot", "warm", "mild", "cool", "cold"].includes(explicitCategory)) {
        return explicitCategory as "hot" | "warm" | "mild" | "cool" | "cold";
    }

    const temp = getTemperature(weather);

    if (temp === null) {
        return "mild";
    }

    if (temp >= WEATHER_THRESHOLDS.hotTempF) return "hot";
    if (temp >= WEATHER_THRESHOLDS.warmTempF) return "warm";
    if (temp >= WEATHER_THRESHOLDS.coldTempF) return "cold";
    if (temp >= WEATHER_THRESHOLDS.coolTempF) return "cool";
    return "mild";
}

function scoreTemperature(item: ConditionScoreableGearItem, weather: WeatherInput): { score: number; explanation: string } {
    const condition = getTemperatureCondition(weather);

    if (condition === "hot" || condition === "warm") {
        const baseScore = getSuitability(item, "hot");
        const tagBoost = hasAnyTag(item, HOT_WEATHER_TAGS) ? 0.08 : 0;
        const score = clamp(baseScore + tagBoost);
        return {
            score,
            explanation: score >= 0.75 ? `Strong temperature match for ${condition} conditions.` : `Temperature match is limited for ${condition} conditions.`,
        };
    }

    if (condition === "cold" || condition === "cool") {
        const baseScore = getSuitability(item, "cold");
        const tagBoost = hasAnyTag(item, LAYERING_TAGS) ? 0.08 : 0;
        const score = clamp(baseScore + tagBoost);
        return {
            score,
            explanation: score >= 0.75 ? `Strong insulation and coverage match for ${condition} conditions.` : `Cold-weather coverage is only partial for ${condition} condition.`,
        };
    }

    const hotScore = getSuitability(item, "hot", 0.65);
    const coldScore = getSuitability(item, "cold", 0.65);
    const score = clamp((hotScore + coldScore) / 2);

    return {
        score,
        explanation: `Balanced temperature score for mild conditions.`,
    };
}

function scoreRain(item: ConditionScoreableGearItem, weather: WeatherInput): { score: number; explanation: string } {
    const precipitationChance = weather.precipitationChance ?? 0;
    const rainSuitability = getSuitability(item, "rain", 0.55);

    if (precipitationChance >= WEATHER_THRESHOLDS.rainLikelyChance) {
        const tagBoost = hasAnyTag(item, RAIN_TAGS) ? 0.08 : 0;
        const score = clamp(rainSuitability + tagBoost);
        return {
            score,
            explanation: score >= 0.7 ? `Handles likely precipitation with rain-ready materials or tags.` : `Precipitation risk reduces confidence for this item.`,
        };
    }

    const score = clamp(0.75 + rainSuitability * 0.25);
    return {
        score,
        explanation: `Low precipitation risk keeps rain protection from dominating the score.`,
    };
}

function scoreWind(item: ConditionScoreableGearItem, weather: WeatherInput): { score: number; explanation: string } {
    const windSpeed = weather.windSpeed ?? 0;
    const windSuitability = getSuitability(item, "wind", 0.55);

    if (windSpeed >= WEATHER_THRESHOLDS.windyMph) {
        const tagBoost = hasAnyTag(item, WIND_TAGS) ? 0.08 : 0;
        const score = clamp(windSuitability + tagBoost);
        return {
            score,
            explanation: score >= 0.7 ? `Wind score is strong for breezy or exposed routes.` : `Wind may cut through this item in exposed conditions.`,
        };
    }

    const score = clamp(0.8 + windSuitability * 0.2);
    return {
        score,
        explanation: `Wind is manageable, so wind protection is a secondary factor.`,
    };
}

function scoreLayering(item: ConditionScoreableGearItem, weather: WeatherInput): { score: number; explanation: string} {
    const tempCondition = getTemperatureCondition(weather);
    const precipitationChance = weather.precipitationChance ?? 0;
    const windy = (weather.windSpeed ?? 0) >= WEATHER_THRESHOLDS.windyMph;
    const layeringUseful = ["cold", "cool"].includes(tempCondition) || windy || precipitationChance >= WEATHER_THRESHOLDS.rainLikelyChance;
    const hasLayering = hasAnyTag(item, LAYERING_TAGS);
    const category = normalizeText(item.category);

    if (!layeringUseful) {
        const score = hasLayering && category === "top" ? 0.68 : 0.9;
        return {
            score, 
            explanation: hasLayering ? `Layering is not essential in these conditions, so bulky layers are softened.` : `Simple single-layer compatibility fits the weather context.`,
        };
    }

    const score = hasLayering || category === "accessory" ? 0.9 : 0.62;
    return {
        score, 
        explanation: score >= 0.8 ? `Layering compatibility supports changing weather conditions` : `Layering compatibility is limited for the current weather`,
    };
}

function scoreCategoryFit(item: ConditionScoreableGearItem): { score: number; explanation: string } {
    const category = normalizeText(item.category) as keyof typeof CATEGORY_IMPORTANCE_WEIGHTS;
    const score = category in CATEGORY_IMPORTANCE_WEIGHTS ? 1 : 0.55;

    return {
        score, 
        explanation: score === 1 ? `${titleCase(category)} contributes to outfit completeness` : `Category is not part of the primary outfit completeness rules.`,
    };
}

function contribution(key: ScoreBreakdownKey, score: number): ScoreContribution {
    const weight = CONDITION_SCORING_WEIGHTS[key];
    return {
        key, 
        score: roundTo(clamp(score) * 100, 1),
        weight,
        weightedScore: roundTo(clamp(score) * weight * 100, 1),
    };
}

export function scoreItemForConditions<TItem extends ConditionScoreableGearItem>(
    item: TItem,
    weather: WeatherInput
): ConditionScoreResult<TItem> {
    const temperature = scoreTemperature(item, weather);
    const precipitation = scoreRain(item, weather);
    const wind = scoreWind(item, weather);
    const layering = scoreLayering(item, weather);
    const categoryFit = scoreCategoryFit(item);

    const weightedEntries = [
        { key: "temperature" as const, ...temperature},
        { key: "precipitation" as const, ...precipitation},
        { key: "wind" as const, ...wind},
        { key: "layering" as const, ...layering},
        { key: "categoryFit" as const, ...categoryFit},
    ];

    const normalizedScore = weightedSum(weightedEntries.map((entry) => ({
        value: entry.score,
        weight: CONDITION_SCORING_WEIGHTS[entry.key],
    })));

    return {
        item,
        score: roundTo(normalizedScore * 100, 1),
        normalizedScore: roundTo(normalizedScore, 3),
        breakdown: weightedEntries.map((entry) => contribution(entry.key, entry.score)),
        explanation: weightedEntries.map((entry) => entry.explanation),
    };
}

export function scoreItemsForConditions<TItem extends ConditionScoreableGearItem>(
    items: readonly TItem[],
    weather: WeatherInput,
): Array<ConditionScoreResult<TItem>> {
    return items
        .map((item) => scoreItemForConditions(item, weather))
        .sort((left, right) => right.score - left.score || normalizeText(left.item.name).localeCompare(normalizeText(right.item.name)));
}