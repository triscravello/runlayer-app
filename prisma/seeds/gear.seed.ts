import { Category, PriceRange, Brand } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { GearSeedItem, loadGearSeedData } from "./data/gear.data";

type BodyTypeFitScores = Record<"lean" | "average" | "larger", number>;

const bodyTypeFitThreshold = 0.8;

function toGearCategory(category: string): Category {
    switch (category) {
        case "top":
            return Category.TOP;
        case "bottom": 
            return Category.BOTTOM;
        case "accessory":
            return Category.ACCESSORY;
        default: 
            throw new Error(`Unsupported gear category: ${category}`);
    }
}

function toGearPriceRange(priceRange: string): PriceRange {
    switch (priceRange) {
        case "budget":
            return PriceRange.BUDGET;
        case "mid":
            return PriceRange.MID;
        case "premium":
            return PriceRange.PREMIUM;
        default:
            throw new Error(`Unsupported gear price range: ${priceRange}`);
    }
}

function toBodyTypeFit(bodyTypeFit: BodyTypeFitScores) {
    return Object.entries(bodyTypeFit)
        .filter(([, score]) => score >= bodyTypeFitThreshold)
        .map(([bodyType]) => bodyType);
}

async function resolveBrands(items: GearSeedItem[]): Promise<Map<string, Brand>> {
    const brandNames = [...new Set(items.map((item) => item.brand))];
    const brandCache = new Map<string, Brand>();

    await Promise.all(
        brandNames.map(async (name) => {
            const brand = await prisma.brand.upsert({
                where: { name },
                update: {},
                create: { name },
            });
            brandCache.set(name, brand);
        })
    );

    return brandCache;
}

function buildGearRecords(items: GearSeedItem[], brandCache: Map<string, Brand>) {
    return items.map((item) => {
        const brand = brandCache.get(item.brand);
        if (!brand) {
            throw new Error(`Brand not found in cache: ${item.brand}`);
        }

        return {
            where: {
                name: item.name,
                brandId: brand.id,
            },
            create: {
                name: item.name,
                brandId: brand.id,
                genderTarget: item.genderTarget,
                category: toGearCategory(item.category),
                subcategory: item.subcategory,
                priceRange: toGearPriceRange(item.priceRange),
                tags: item.tags,
                weatherHot: item.weatherSuitability.hot,
                weatherCold: item.weatherSuitability.cold,
                weatherRain: item.weatherSuitability.rain,
                bodyTypeFit: toBodyTypeFit(item.bodyTypeFit),
                imageUrl: item.imageUrl,
                affiliateUrl: item.affiliateUrl,
            },
            update: {
                genderTarget: item.genderTarget,
                category: toGearCategory(item.category),
                subcategory: item.subcategory,
                priceRange: toGearPriceRange(item.priceRange),
                tags: item.tags,
                weatherHot: item.weatherSuitability.hot,
                weatherCold: item.weatherSuitability.cold,
                weatherRain: item.weatherSuitability.rain,
                bodyTypeFit: toBodyTypeFit(item.bodyTypeFit),
                imageUrl: item.imageUrl,
                affiliateUrl: item.affiliateUrl,
            },
        };
    });
}

async function seedGearItems(records: ReturnType<typeof buildGearRecords>) {
    await prisma.$transaction(records.map((record) => prisma.gearItem.upsert(record)));
}

async function main() {
    const gearData = loadGearSeedData();
    const brandCache = await resolveBrands(gearData);
    const gearRecords = buildGearRecords(gearData, brandCache);

    await seedGearItems(gearRecords);

    console.log(`Gear seed completed with ${gearData.length} records`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });