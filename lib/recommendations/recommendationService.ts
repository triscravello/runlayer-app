import { runTypeData } from "./runTypeData";
import type { RecommendationWeather, RunType, RunTypeRecommendation } from "./recommendationTypes";

export function getRunTypeRecommendation(
    runType: RunType,
    weather: RecommendationWeather,
): RunTypeRecommendation {
    void weather;

    return runTypeData[runType];
}