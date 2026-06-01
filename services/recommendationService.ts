import type { Prisma } from "@prisma/client";
import type { GearRecommendationResult, UserInput } from "@/lib/engine/recommendationEngine";
import { readJsonResponse, type ServiceRequestOptions } from "./apiResponse";

export type { GearRecommendationResult, UserInput };

export type FeedbackType = "HELPFUL" | "NOT_HELPFUL";

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

export type RecommendationHistoryItem = {
    id: string;
    rank: number;
    totalScore: number;
    breakdown: Prisma.JsonValue;
    gearItem: {
        id: string;
        name: string;
        category: string;
        tags: string[];
        brand?: { name: string } | null;
    };
    feedback: Array<{ feedbackType: FeedbackType }>;
}

export type RecommendationHistoryRecord = RecommendationRecord & {
    weatherSnapshot?: { condition?: string | null; tempCategory?: string | null } | null;
    items: RecommendationHistoryItem[];
}

export type RecommendationFeedbackResponse = {
    feedback: {
        id: string;
        recommendationId: string;
        userId: string;
        feedbackType: FeedbackType;
        createdAt: string | Date;
    };
    status: "recorded";
}

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

    async getRecommendationHistory(input: { userId?: string; limit?: number; offset?: number } = {}, options: ServiceRequestOptions = {}): Promise<RecommendationHistoryRecord[]> {
        const params = new URLSearchParams();
        if (input.userId) params.set("userId", input.userId);
        if (input.limit) params.set("limit", String(input.limit));
        if (input.offset) params.set("offset", String(input.offset));

        const query = params.toString();
        const response = await fetch(`/api/recommendation/history?${query ? `&${query}` : ""}`, {
            credentials: "include",
            signal: options.signal,
        });

        return readJsonResponse<RecommendationHistoryRecord[]>(response, "Unable to load recommendation history.");
    }, 

    async submitFeedback(input: { userId?: string; recommendationId: string; feedbackType: FeedbackType }): Promise<RecommendationFeedbackResponse> {
        const response = await fetch("api/recommendation/feedback", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify(input),
        });

        return readJsonResponse<RecommendationFeedbackResponse>(response, "Unable to submit recommendation feedback.");
    }
};