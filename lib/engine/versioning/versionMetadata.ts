import { RECOMMENDATION_ENGINE_VERSION } from "@/config/recommendationEngineVersion";

export type RecommendationEngineVersionMetadata = {
    version: string;
    releaseDate: string;
    description: string;
};

export const RECOMMENDATION_ENGINE_VERSION_METADATA: RecommendationEngineVersionMetadata[] = [
    {
        version: "1.0.0",
        releaseDate: "2026-06-03",
        description: "Initial multi-factor recommendation engine with personalized scoring, feedback capture, and saved-kit observability",
    },
];

export function getCurrentRecommendationEngineMetadata() {
    return RECOMMENDATION_ENGINE_VERSION_METADATA.find(
        (metadata) => metadata.version === RECOMMENDATION_ENGINE_VERSION,
    ) ?? RECOMMENDATION_ENGINE_VERSION_METADATA[0];
}