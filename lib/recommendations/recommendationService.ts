import { runTypeData } from "./runTypeData";
import type { RecommendationWeather, RunType, RunTypeRecommendation } from "./recommendationTypes";

type RecommendationTag = {
    label: string;
    tone?: "default" | "weather" | "workout" | "attribute";
};

type RecommendationReason = string | { tags: string[] };

type RecommendationTemplate = {
    title: string;
    tags: RecommendationTag[];
    items: Array<{
        id: string;
        label: string;
        category: string;
        description?: string;
        attributes?: string[];
        group?: string;
        icon?: string;
    }>;
    attributes: Array<{ label: string; value?: string }>;
    why: RecommendationReason[];
};

type BrandTemplate = {
    filterTags: string[];
    items: Array<{
        id: string;
        name: string;
        rank: number;
        score: number;
        summary?: string;
        tags?: string[];
        why?: string;
        href?: string;
    }>;
};

type RunTypeTemplate = {
    recommendation: RecommendationTemplate;
    brands: BrandTemplate;
};

const neutralStats = {
    savedOutfits: 0,
    brandsTracked: 0,
    accuracyPercent: 0,
};

function normalizeTag(value: string) {
    return value.trim().toLowerCase().replaceAll(" ", "-");
}

function getWeatherTags(weather: RecommendationWeather): RecommendationTag[] {
    const weatherLabels = weather.labels.length ? weather.labels: [weather.impactLabel];

    return weatherLabels.map((label) => ({
        label,
        tone: "weather" as const,
    }));
}

function getWeatherReasonTags(weather: RecommendationWeather) {
    return [
        ...weather.labels,
        weather.impactLabel,
        weather.condition,
    ].filter(Boolean).map(normalizeTag);
}

function getWeatherReasons(weather: RecommendationWeather) {
    const labels = weather.labels.length ? weather.labels.join(", ").toLowerCase() : weather.impactLabel.toLowerCase();

    return [
        weather.recommendationNote,
        `Current ${weather.condition.toLowerCase()} conditions in ${weather.location} are treated as ${labels}.`,
        { tags: getWeatherReasonTags(weather) },
    ]
}

function scoreBrandForWeather(brandTags: string[] = [], weatherTags: string[]) {
    const normalizedBrandTags = new Set(brandTags.map(normalizeTag));

    return weatherTags.reduce((score, tag) => score + (normalizedBrandTags.has(tag) ? 8 : 0), 0);
}

function updateBrandsForWeather(brands: BrandTemplate, weather: RecommendationWeather): BrandTemplate {
    const weatherTags = getWeatherReasonTags(weather);
    const filterTags = Array.from(new Set([...weatherTags.slice(0, 4), ...brands.filterTags]));
    const items = brands.items
        .map((brand) => {
            const weatherScore = scoreBrandForWeather(brand.tags, weatherTags);
            const score = Math.min(100, brand.score + weatherScore);

            return {
                ...brand,
                score,
                why: weatherScore > 0
                    ? `${brand.why} Weather match: ${weather.impactLabel.toLowerCase()} (${weather.condition}).`
                    : brand.why,
            };
        })
        .sort((a, b) => b.score - a.score)
        .map((brand, index) => ({
            ...brand,
            rank: index + 1,
        }));

    return { filterTags, items };
}

function updateRecommendationForWeather(recommendation: RecommendationTemplate, weather: RecommendationWeather): RecommendationTemplate {
    const nonWeatherTags = recommendation.tags.filter((tag) => tag.tone !== "weather");

    return {
        ...recommendation,
        tags: [...getWeatherTags(weather), ...nonWeatherTags],
        why: [...getWeatherReasons(weather), ...recommendation.why.filter((reason) => typeof reason !== "string")],
    };
}

export function getRunTypeRecommendation(
    runType: RunType,
    weather: RecommendationWeather,
): RunTypeRecommendation {
    const template = runTypeData[runType] as RunTypeRecommendation & RunTypeTemplate;

    return {
        recommendation: updateRecommendationForWeather(template.recommendation, weather),
        brands: updateBrandsForWeather(template.brands, weather),
        stats: neutralStats,
    };
}