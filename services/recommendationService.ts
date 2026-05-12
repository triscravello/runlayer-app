import type { Prisma } from "@prisma/client";
import type { GearRecommendationResult, UserInput } from "@/lib/engine/recommendationEngine";
import { readJsonResponse, type ServiceRequestOptions } from "./apiResponse";

export type { GearRecommendationResult, UserInput };

export type CreateRecommendationInput = {
    userId: string;
    weatherSnapshotId?: string | null;
    inputContext: Prisma.InputJsonValue;
    output: Prisma.InputJsonValue;
    topScore?: number | null;
    algorithmVersion?: string | null;
};

export type RecommendationRecord = {
    id: string;
    userId: string;
    weatherSnapshotId: string | null;
    inputContext: Prisma.JsonValue;
    output: Prisma.JsonValue;
    topScore: number | null;
    algorithmVersion: string | null;
    createdAt: string | Date;
};

export const recommendationService = {
    async getRecommendations(options: ServiceRequestOptions = {}): Promise<RecommendationRecord[]> {
        const response = await fetch("/api/recommendation", {
            credentials: "include",
            signal: options.signal,
        });

        return readJsonResponse<RecommendationRecord[]>(response, "Unable to load recommendations.");
    },

    async generateRecommendations(input: UserInput, options: ServiceRequestOptions = {}): Promise<GearRecommendationResult> {
        const response = await fetch("/api/recommend", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify(input),
            signal: options.signal,
        });

        return readJsonResponse<GearRecommendationResult>(response, "Unable to generate recommendations.");
    },

    async saveRecommendation(input: CreateRecommendationInput): Promise<RecommendationRecord> {
        const response = await fetch("/api/recommendation", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify(input),
        });

        return readJsonResponse<RecommendationRecord>(response, "Unable to save recommendation.");
    },
};