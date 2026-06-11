export type RunType = "easy" | "long" | "intervals";

export const validRunTypes = new Set<RunType>(["easy", "long", "intervals"]);

export type RunTypeRecommendation = {
    recommendation: unknown;
    brands: unknown;
    stats: unknown;
};

export type RecommendationWeather = {
    location: string;
    temperature: number;
    feelsLike: number;
    condition: string;
    humidity: number;
    precipitationChance: number;
    windSpeed: number;
    uvIndex: number;
    impactLabel: string;
    labels: string[];
    recommendationNote: string;
};