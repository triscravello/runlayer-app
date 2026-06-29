import type { Prisma } from "@prisma/client";
import { RECOMMENDATION_ENGINE_VERSION } from "@/config/recommendationEngineVersion";
import { prisma } from "../prisma";

type JsonInputValue = Prisma.InputJsonValue;
export type SavedKitType = "race-day" | "intervals" | "long-run" | "trail" | "rain" | "cold-weather" | "summer" | "favorites" | "race_day" | "training" | "custom"

export type CreateRecommendationInput = {
    userId: string;
    weatherSnapshotId?: string | null;
    inputContext: JsonInputValue;
    output: JsonInputValue;
    topScore?: number | null;
    algorithmVersion?: string | null;
    engineVersion?: string | null;
    generatedAt?: Date | string | null;
};

export type SaveOutfitInput = {
    userId: string;
    recommendationId?: string | null;
    name?: string | null;
    description?: string | null;
    category?: SavedKitType | string | null;
    type?: SavedKitType | string | null;
    isFavorite?: boolean | null;
    gearItemIds?: string[] | null;
};

export class OutfitValidationError extends Error {
    constructor(message: string, public readonly statusCode = 400) {
        super(message);
        this.name = "OutfitValidationError";
    }
}

export type UpdateSavedOutfitInput = {
    userId: string;
    outfitId: string;
    name?: string | null;
    description?: string | null;
    category?: SavedKitType | string | null;
    type?: SavedKitType | string | null;
    isFavorite?: boolean | null;
    gearItemIds?: string[] | null;
};

function normalizeKitType(type?: string | null): SavedKitType {
    const normalized = type === "race_day" ? "race-day" : type;
    if (
        normalized === "race-day" ||
        normalized === "intervals" ||
        normalized === "long-run" ||
        normalized === "trail" ||
        normalized === "rain" ||
        normalized === "cold-weather" || 
        normalized === "summer" ||
        normalized === "favorites" ||
        normalized === "training" || 
        normalized === "custom"
    ) return normalized;
    return "favorites";
}

function toUniqueGearIds(gearItemIds?: string[] | null) {
    return [...new Set((gearItemIds ?? []).map((id) => id.trim()).filter(Boolean))];
}

async function findGearItemsOrThrow(gearItemIds?: string[] | null) {
    const uniqueIds = toUniqueGearIds(gearItemIds);

    if (!uniqueIds) {
        throw new OutfitValidationError("Missing gear items.", 400);
    }

    const gearItems = await prisma.gearItem.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true, category: true },
    });
    const foundIds = new Set(gearItems.map((gearItem) =>gearItem.id));
    const missingIds = uniqueIds.filter((id) => !foundIds.has(id));

    if (missingIds.length) {
        throw new OutfitValidationError(`Missing gear items: ${missingIds.join(", ")}.`, 400);
    }

    return gearItems;
}

async function replaceOutfitItems(outfitId: string, gearItemIds?: string[] | null) {
    if (!gearItemIds) return;

    const gearItems = await findGearItemsOrThrow(gearItemIds);
    await prisma.outfitItem.deleteMany({ where: { outfitId } });

    await prisma.outfitItem.createMany({
        data: gearItems.map((gearItem) => ({
            outfitId,
            gearItemId: gearItem.id,
            category: gearItem.category,
        })),
    });
}

export async function listSavedOutfitsByUserId(userId: string) {
    return prisma.savedOutfit.findMany({
        where: { userId },
        include: {
            recommendation: true,
            OutfitItem: {
                include: {
                    gearItem: {
                        include: { brand: true },
                    },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function getSavedOutfitById(userId: string, outfitId: string) {
    return prisma.savedOutfit.findFirst({
        where: { id: outfitId, userId },
        include: {
            recommendation: true,
            OutfitItem: {
                include: {
                    gearItem: { include: { brand: true } },
                },
            },
        },
    });
}

export async function saveOutfit(input: SaveOutfitInput) {
    if (input.recommendationId) {
        const recommendation = await prisma.recommendation.findFirst({
            where: { id: input.recommendationId, userId: input.userId },
            select: { id: true },
        });

        if (!recommendation) {
            throw new OutfitValidationError("Recommendation not found for this user.", 404);
        }
    }

    await findGearItemsOrThrow(input.gearItemIds);

    const savedOutfit = await prisma.savedOutfit.create({
        data: {
            userId: input.userId,
            recommendationId: input.recommendationId ?? null,
            name: input.name ?? "Saved Kit",
            description: input.description ?? null,
            type: normalizeKitType(input.category ?? input.type),
            isFavorite: input.isFavorite ?? false,
        },
    });

    await replaceOutfitItems(savedOutfit.id, input.gearItemIds);
    return getSavedOutfitById(input.userId, savedOutfit.id) ?? savedOutfit;
}

export async function updateSavedOutfit(input: UpdateSavedOutfitInput) {
    const updated = await prisma.savedOutfit.updateMany({
        where: { id: input.outfitId, userId: input.userId },
        data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description} : {}),
            ...(input.category !== undefined || input.type !== undefined ? { type: normalizeKitType(input.category ?? input.type) } : {}),
            ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite ?? false }: {}),
        }
    });

    if (!updated.count) return null;

    await replaceOutfitItems(input.outfitId, input.gearItemIds);
    return getSavedOutfitById(input.userId, input.outfitId);
}

export async function deleteSavedOutfitById(userId: string, outfitId: string) {
    return prisma.savedOutfit.deleteMany({ where: { id: outfitId, userId } });
}

export async function listGeneratedOutfits() {
    return prisma.recommendation.findMany({
        orderBy: { createdAt: "desc" },
        include: { user: true, weatherSnapshot: true },
    });
}

export async function createGeneratedOutfit(input: CreateRecommendationInput) {
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
                    timestamp: input.generatedAt ? new Date(input.generatedAt) : undefined
                },
            },
        },
    });
}

export async function listOutfitHistoryByUserId(userId: string) {
    return prisma.recommendation.findMany({
        where: { userId },
        include: { savedOutfits: true, weatherSnapshot: true },
        orderBy: { createdAt: "desc" },
    });
}