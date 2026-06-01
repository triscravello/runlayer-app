import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { ScoredRecommendationItem } from "../engine/types/recommendationEngine";

export type CreateRecommendationHistoryInput = {
    userId: string;
    weatherSnapshotId?: string | null;
    inputContext: Prisma.InputJsonValue;
    output: Prisma.InputJsonValue;
    topScore?: number | null;
    algorithmVersion?: string | null;
    recommendations: ScoredRecommendationItem[];
};

export type RecommendationHistoryListOptions = {
    userId: string;
    take?: number;
    skip?: number;
};

export async function createRecommendationHistory(input: CreateRecommendationHistoryInput) {
    return prisma.recommendation.create({
        data: {
            userId: input.userId,
            weatherSnapshotId: input.weatherSnapshotId ?? null,
            inputContext: input.inputContext,
            output: input.output,
            topScore: input.topScore ?? null,
            algorithmVersion: input.algorithmVersion ?? null,
            items: {
                create: input.recommendations.map((recommendation, index) => ({
                    gearItemId: recommendation.item.id,
                    rank: index + 1,
                    totalScore: recommendation.totalScore,
                    breakdown: recommendation.scoreBreakdown as unknown as Prisma.InputJsonValue,
                })),
            },
        },
        include: {
            items: {
                include: {
                    gearItem: {
                        include: {
                            brand: true,
                        },
                    },
                    feedback: true,
                },
                orderBy: {
                    rank: "asc",
                },
            },
        },
    });
}

export async function listRecommendationHistoryByUserId(options: RecommendationHistoryListOptions) {
    return prisma.recommendation.findMany({
        where: {
            userId: options.userId,
        },
        include: {
            weatherSnapshot: true,
            items: {
                include: {
                    gearItem: {
                        include: {
                            brand: true,
                        },
                    },
                    feedback: {
                        where: {
                            userId: options.userId,
                        },
                    },
                },
                orderBy: {
                    createdAt: "desc",
                },
            },
        },
        orderBy: {
            createdAt: "desc",
        },
        take: options.take ?? 20,
        skip: options.skip ?? 0,
    });
}