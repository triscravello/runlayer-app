import type { Prisma } from "@prisma/client";
import { RECOMMENDATION_ENGINE_VERSION } from "@/config/recommendationEngineVersion";
import { prisma } from "../prisma";
import type { ScoredRecommendationItem } from "../engine/types/recommendationEngine";

export type CreateRecommendationHistoryInput = {
    userId: string;
    weatherSnapshotId?: string | null;
    inputContext: Prisma.InputJsonValue;
    output: Prisma.InputJsonValue;
    topScore?: number | null;
    algorithmVersion?: string | null;
    engineVersion?: string | null;
    generatedAt?: Date | string | null;
    recommendations: ScoredRecommendationItem[];
};

export type RecommendationHistoryListOptions = {
    userId: string;
    take?: number;
    skip?: number;
};

export async function createRecommendationHistory(input: CreateRecommendationHistoryInput) {
    const engineVersion = input.engineVersion ?? input.algorithmVersion ?? RECOMMENDATION_ENGINE_VERSION;

    return prisma.recommendation.create({
        data: {
            userId: input.userId,
            weatherSnapshotId: input.weatherSnapshotId ?? null,
            inputContext: input.inputContext,
            output: input.output,
            topScore: input.topScore ?? null,
            algorithmVersion: input.algorithmVersion ?? engineVersion,
            engineVersion,
            generatedAt: input.generatedAt ? new Date(input.generatedAt) : undefined,
            versionMetadata: {
                create: {
                    engineVersion,
                    timestamp: input.generatedAt ? new Date(input.generatedAt) : undefined,
                },
            },
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

export async function deleteRecommendationHistoryById(userId: string, recommendationId: string) {
    return prisma.recommendation.deleteMany({
        where: {
            id: recommendationId,
            userId,
        },
    });
}

export async function listRecommendationHistoryByUserId(options: RecommendationHistoryListOptions) {
    const history = await prisma.recommendation.findMany({
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
            },
        },
        orderBy: {
            generatedAt: "desc",
        },
        take: options.take ?? 20,
        skip: options.skip ?? 0,
    });

    return history.map((recommendation) => ({
        ...recommendation,
        items: [...recommendation.items].sort((left, right) => left.rank - right.rank),
    }))
}