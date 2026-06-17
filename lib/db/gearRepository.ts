import { prisma } from "@/lib/prisma";
import type { GearItem } from "../engine/recommendationEngine";

export type GearItemRow = Awaited<ReturnType<typeof prisma.gearItem.findMany>>[number];

type CreateGearInput = {
    name: string;
    brandId: string;
    genderTarget?: string | null;
    category: GearItemRow["category"];
    subcategory?: string | null;
    priceRange: GearItemRow["priceRange"];
    tags?: string[];
    weatherSuitability?: Partial<Record<"hot" | "warm" | "cold" | "rain" | "wind", number | null>>;
    bodyTypeFit?: string[];
    imageUrl?: string | null;
    affiliateUrl?: string | null;
}

type UpdateGearInput = Partial<Omit<CreateGearInput, "weatherSuitability">> & {
    id: string;
    weatherSuitability?: CreateGearInput["weatherSuitability"];
};

export async function listGearItems() {
    return prisma.gearItem.findMany({
        include: {
            brand: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });
}

export async function createGearItem(input: CreateGearInput) {
    return prisma.gearItem.create({
        data: {
            name: input.name,
            brandId: input.brandId,
            genderTarget: input.genderTarget,
            category: input.category,
            subcategory: input.subcategory,
            priceRange: input.priceRange,
            tags: input.tags ?? [],
            weatherHot: input.weatherSuitability?.hot ?? input.weatherSuitability?.warm,
            weatherCold: input.weatherSuitability?.cold,
            weatherRain: input.weatherSuitability?.rain,
            weatherWind: input.weatherSuitability?.wind,
            bodyTypeFit: input.bodyTypeFit ?? [],
            imageUrl: input.imageUrl,
            affiliateUrl: input.affiliateUrl,
        },
    });
}

export async function updateGearItem(input: UpdateGearInput) {
    const { id, weatherSuitability, ...gearData} = input;

    return prisma.gearItem.update({
        where: { id },
        data: {
            ...gearData,
            weatherHot: weatherSuitability?.hot ?? input.weatherSuitability?.warm,
            weatherCold: weatherSuitability?.cold,
            weatherRain: weatherSuitability?.rain,
            weatherWind: weatherSuitability?.wind,
        },
    });
}

export async function deleteGearItem(id: string) {
    return prisma.gearItem.delete({
        where: { id },
    });
}

function mapGearItemForRecommendation(gearItem: GearItemRow): GearItem {
    return {
        ...gearItem,
        weatherSuitability: {
            hot: gearItem.weatherHot ?? 0,
            warm: gearItem.weatherHot ?? 0,
            cold: gearItem.weatherCold ?? 0,
            rain: gearItem.weatherRain ?? 0,
            wind: gearItem.weatherWind ?? 0,
        },
    };
}

export async function listGearRecommendationCandidates(): Promise<GearItem[]> {
    const gearItems = await prisma.gearItem.findMany({
        include: {
            brand: true,
        },
    });

    return gearItems.map((gearItem) => ({
        ...mapGearItemForRecommendation(gearItem),
        brandName: gearItem.brand.name,
    }));
}

export async function listWardrobeByUserId(userId: string) {
    return prisma.outfitItem.findMany({
        where: {
            outfit: {
                userId,
            },
        },
        include: {
            gearItem: {
                include: {
                    brand: true,
                }
            },
            outfit: true,
        },
        orderBy: {
            outfit: {
                createdAt: "desc",
            },
        },
    });
}