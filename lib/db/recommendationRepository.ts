import type { Prisma } from "@prisma/client";
import { RECOMMENDATION_ENGINE_VERSION } from "@/config/recommendationEngineVersion";
import { prisma } from "../prisma";
import type { ScoredRecommendationItem } from "../engine/types/recommendationEngine";

export type CreateRecommendationWeatherSnapshotInput = {
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    tempF?: number | null;
    humidity?: number | null;
    windSpeed?: number | null;
    precipitationChance?: number | null;
    uvIndex?: number | null;
    condition?: string | null;
    tempCategory?: string | null;
};

export type CreateRecommendationHistoryInput = {
    userId: string;
    weatherSnapshotId?: string | null;
    weatherSnapshot?: CreateRecommendationWeatherSnapshotInput | null;
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

function toWeatherSnapshotCreateInput(input?: CreateRecommendationWeatherSnapshotInput | null): Prisma.WeatherSnapshotCreateWithoutRecommendationsInput | null {
    if (!input?.location) return null;

    return {
        location: input.location,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        tempF: input.tempF ?? null,
        humidity: input.humidity ?? null,
        windSpeed: input.windSpeed ?? null,
        precipitationChance: input.precipitationChance ?? null,
        uvIndex: input.uvIndex ?? null,
        condition: input.condition ?? null,
        tempCategory: input.tempCategory ?? null,
    };
}

export async function createRecommendationHistory(input: CreateRecommendationHistoryInput) {
    const engineVersion = input.engineVersion ?? input.algorithmVersion ?? RECOMMENDATION_ENGINE_VERSION;
    const weatherSnapshotCreateInput = input.weatherSnapshotId ? null : toWeatherSnapshotCreateInput(input.weatherSnapshot);
    const createdWeatherSnapshot = weatherSnapshotCreateInput ? await prisma.weatherSnapshot.create({ data: weatherSnapshotCreateInput }).catch((error: unknown) => {
        console.warn("Unable to persist recommendation weather snapshot", error);
        return null;
    }) : null;

    return prisma.recommendation.create({
        data: {
            userId: input.userId,
            weatherSnapshotId: input.weatherSnapshotId ?? createdWeatherSnapshot?.id ?? null,
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

type RecommendationHistoryDeleteClient = Pick<Prisma.TransactionClient, "recommendation" | "recommendationFeedback" | "recommendationItem" | "recommendationVersionMetadata" | "savedOutfit">;

export async function deleteRecommendationHistoryById(userId: string, recommendationId: string) {
    return prisma.$transaction(async (tx: RecommendationHistoryDeleteClient) => {
        const recommendation = await tx.recommendation.findFirst({
            where: {
                id: recommendationId,
                userId,
            },
            select: {
                id: true,
            }
        });

        if (!recommendation) {
            return { count : 0 };
        };

        await tx.savedOutfit.updateMany({
            where: {
                recommendationId,
            },
            data: {
                recommendationId: null,
            },
        });

        await tx.recommendationFeedback.deleteMany({
            where: {
                recommendation: {
                    recommendationId,
                },
            },
        });

        await tx.recommendationItem.deleteMany({
            where: {
                recommendationId,
            },
        });

        await tx.recommendationVersionMetadata.deleteMany({
            where: {
                recommendationId,
            },
        });

        return tx.recommendation.deleteMany({
            where: {
                id: recommendationId,
                userId,
            },
        });
    })
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