import { prisma } from "@/lib/prisma";
import { 
    filterByCategory, 
    rankGearList,
    type GearItem,
    type RankedGearItem,
    type UserInput
} from "@/lib/engine/recommendationEngine";

const DEFAULT_RECOMMENDATION_LIMIT = 5;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonInputValue = Exclude<JsonValue, null>;

export type CreateRecommendationInput = {
    userId: string;
    weatherSnapshotId?: string | null;
    inputContext: JsonInputValue;
    output: JsonInputValue;
    topScore?: number | null;
    algorithmVersion?: string | null;
}

export type GearRecommendationResult = {
    recommendations: RankedGearItem[];
}

type GearItemRow = Awaited<ReturnType<typeof prisma.gearItem.findMany>>[number];

function mapGearItemForScoring(gearItem: GearItemRow): GearItem {
    return {
        ...gearItem,
        weatherSuitability: {
            hot: gearItem.weatherHot ?? 0,
            cold: gearItem.weatherCold ?? 0,
            rain: gearItem.weatherRain ?? 0,
            wind: gearItem.weatherWind ?? 0,
        },
    };
}

export async function listRecommendations() {
    return prisma.recommendation.findMany({
        orderBy: {
            createdAt: "desc",
        },
        include: {
            user: true,
            weatherSnapshot: true,
        }
    });
}

export async function createRecommendation(input: CreateRecommendationInput) {
    return prisma.recommendation.create({
        data: {
            userId: input.userId,
            weatherSnapshotId: input.weatherSnapshotId ?? null,
            inputContext: input.inputContext,
            output: input.output,
            topScore: input.topScore ?? null,
            algorithmVersion: input.algorithmVersion ?? null,
        }
    });
}

export async function generateGearRecommendations(
    input: UserInput,
    limit = DEFAULT_RECOMMENDATION_LIMIT,
): Promise<GearRecommendationResult> {
    const gearItems = await prisma.gearItem.findMany();
    const scorableGear = gearItems.map(mapGearItemForScoring);
    const filteredGear = filterByCategory(scorableGear, input.category);
    const recommendations = rankGearList(input, filteredGear).slice(0, limit);

    return { recommendations };
}