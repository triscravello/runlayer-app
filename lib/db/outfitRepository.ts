import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

type JsonInputValue = Prisma.InputJsonValue;

export type CreateRecommendationInput = {
    userId: string;
    weatherSnapshotId?: string | null;
    inputContext: JsonInputValue;
    output: JsonInputValue;
    topScore?: number | null;
    algorithmVersion?: string | null;
};

export type SaveOutfitInput = {
    userId: string;
    recommendationId?: string | null;
    name?: string | null;
    isFavorite?: boolean | null;
};

export async function listSavedOutfitsByUserId(userId: string) {
    return prisma.savedOutfit.findMany({
        where: {
            userId
        },
        include: {
            recommendation: true,
            OutfitItem: {
                include: {
                    gearItem: {
                        include: {
                            brand: true,
                        },
                    },
                },
            },
        },
        orderBy: {
            createdAt: "desc",
        },
    });
}

export async function saveOutfit(input: SaveOutfitInput) {
    return prisma.savedOutfit.create({
        data: {
            userId: input.userId,
            recommendationId: input.recommendationId ?? null,
            name: input.name ?? "Saved Outfit",
            isFavorite: input.isFavorite ?? false,
        },
    });
}

export async function deleteSavedOutfitById(userId: string, outfitId: string) {
    return prisma.savedOutfit.deleteMany({
        where: {
            id: outfitId,
            userId,
        },
    });
}

export async function listGeneratedOutfits() {
    return prisma.recommendation.findMany({
        orderBy: {
            createdAt: "desc",
        },
        include: {
            user: true,
            weatherSnapshot: true,
        },
    });
}

export async function createGeneratedOutfit(input: CreateRecommendationInput) {
    return prisma.recommendation.create({
        data: {
            userId: input.userId,
            weatherSnapshotId: input.weatherSnapshotId ?? null,
            inputContext: input.inputContext,
            output: input.output,
            topScore: input.topScore ?? null,
            algorithmVersion: input.algorithmVersion ?? null,
        },
    });
}

export async function listOutfitHistoryByUserId(userId: string) {
    return prisma.recommendation.findMany({
        where: {
            userId,
        },
        include: {
            savedOutfits: true,
            weatherSnapshot: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });
}