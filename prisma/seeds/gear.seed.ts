import { Category, PriceRange } from "@prisma/client";
import type { Brand } from "@prisma/client";
// Erasable TypeScript only; runs under `node --experimental-strip-types`.
import { disconnectSeedClient, prepareSeed, reportSeedFailure } from "./context.ts";
import type { SeedDeps, SeedPrisma } from "./context.ts";
import { loadGearSeedData } from "./data/gear.data.ts";
import type { GearSeedItem } from "./data/gear.data.ts";

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

async function resolveBrands(prisma: SeedPrisma, items: GearSeedItem[]): Promise<Map<string, Brand>> {
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
                imageUrl: item.variants[0]?.imageUrl ?? null,
                affiliateUrl: item.variants[0]?.affiliateUrl ?? null,
                variants: { create: item.variants.map((variant) => ({ label: variant.label, gender: variant.gender, affiliateUrl: variant.affiliateUrl, imageUrl: variant.imageUrl, price: variant.price, sizes: variant.sizes ?? [] })) },
            },
        };
    });
}

// CREATE-ONLY: an item that already exists (same name and brand) is left exactly as it is. Nothing is updated and
// no variants are deleted, so catalog edits made through the admin UI survive repeated seeding.
async function seedGearItems(prisma: SeedPrisma, records: ReturnType<typeof buildGearRecords>) {
    let created = 0;
    let skipped = 0;

    for (const record of records) {
        const existing = await prisma.gearItem.findFirst({
            where: record.where,
            select: { id: true },
        });

        if (existing) {
            skipped += 1;
            continue;
        }

        await prisma.gearItem.create({
            data: record.create,
        });
        created += 1;
    }

    return { created, skipped };
}

export async function seedGearCatalog(deps: SeedDeps = {}): Promise<{ created: number; skipped: number }> {
    // Safety guard first: nothing below runs unless the target is a confirmed, dedicated, local database.
    const { prisma } = await prepareSeed(deps);

    const gearData = loadGearSeedData();
    const brandCache = await resolveBrands(prisma, gearData);
    const gearRecords = buildGearRecords(gearData, brandCache);

    const result = await seedGearItems(prisma, gearRecords);

    console.log(`Gear seed completed: ${result.created} created, ${result.skipped} already present and left unchanged`);

    return result;
}

if (process.argv[1]?.endsWith("gear.seed.ts")) {
    seedGearCatalog()
        .catch((error) => {
            reportSeedFailure(error);
            process.exitCode = 1;
        })
        .finally(disconnectSeedClient);
}