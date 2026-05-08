// prisma/seeds/gear.seed.ts
import { PrismaClient, Category, PriceRange } from "@prisma/client";
import { prisma } from "../../lib/prisma";

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

async function main() {
    // Clear existing data
    await prisma.$executeRaw`DELETE FROM outfit_items`;
    await prisma.gearItem.deleteMany();

    // Seed data
    const gear = [
        {
            name: "Hyper-Speed Tank",
            brand: "Expntl Athletics",
            genderTarget: "women",
            category: "top",
            subcategory: "performance-tank",
            priceRange: "mid",
            tags: ["ultralight", "race-day", "breathable", "tempo", "built-in-bra", "anti-chafe", "performance-fit"],

            weatherSuitability: {
                hot: 0.95,
                warm: 0.9,
                cold: 0.3,
                rain: 0.4
            },

            bodyTypeFit: {
                lean: 0.95,
                average: 0.9,
                larger: 0.75
            },

            imageUrl: "",
            affiliateUrl: ""
        }, 
        {
            name: "Divergent Tank",
            brand: "Expntl Athletics",
            genderTarget: "women",
            category: "top",
            subcategory: "training-tank",
            priceRange: "mid",
            tags: ["training", "breathable", "lightweight", "anti-chafe", "everyday-run"],

            weatherSuitability: {
                hot: 0.9, 
                warm: 0.85,
                cold: 0.4, 
                rain: 0.5
            },

            bodyTypeFit: {
                lean: 0.9,
                average: 0.9,
                larger: 0.8
            }, 

            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "Van Cortlandt Singlet",
            brand: "Tracksmith",
            genderTarget: "men",
            category: "top",
            subcategory: "singlet",
            priceRange: "premium",
            tags: ["race-day", "elite", "lightweight", "breathable"],
            weatherSuitability: {
                hot: 0.95,
                warm: 0.9,
                cold: 0.2, 
                rain: 0.3
            },
            bodyTypeFit: {
                lean: 0.95,
                average: 0.85,
                larger: 0.6
            },
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "Harrier Long Sleeve",
            brand: "Tracksmith",
            genderTarget: "unisex",
            category: "top",
            subcategory: "long-sleeve",
            priceRange: "premium",
            tags: ["cold-weather", "training", "layering", "breathable", "lightweight"],
            weatherSuitability: {
                hot: 0.2,
                warm: 0.6,
                cold: 0.95, 
                rain: 0.7
            }, 
            bodyTypeFit: {
                lean: 0.9,
                average: 0.9,
                larger: 0.85
            },
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "Aeroswift Singlet",
            brand: "Nike",
            genderTarget: "unisex",
            category: "top",
            subcategory: "singlet",
            priceRange: "mid",
            tags: ["daily-run", "training", "breathable", "lightweight", "moisture-wicking", "anti-chafe"],
            weatherSuitability: {
                hot: 0.9,
                warm: 0.85,
                cold: 0.3,
                rain: 0.5
            },
            bodyTypeFit: {
                lean: 0.9,
                average: 0.9,
                larger: 0.75
            },
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "Aeroswift Running Shorts",
            brand: "Nike",
            genderTarget: "unisex",
            category: "bottom",
            subcategory: "shorts",
            priceRange: "mid",
            tags: ["daily-run", "training", "breathable", "lightweight"],
            weatherSuitability: {
                hot: 0.95,
                warm: 0.9,
                cold: 0.4,
                rain: 0.5
            },
            bodyTypeFit: {
                lean: 0.9,
                average: 0.9,
                larger: 0.8
            },
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "Faster Than Light Short",
            brand: "Expntl Athletics",
            genderTarget: "women",
            category: "bottom",
            subcategory: "shorts",
            priceRange: "mid",
            tags: ["ultralight", "race", "breathable", "tempo", "built-in-liner", "anti-chafe", "performance-fit"],
            weatherSuitability: {
                hot: 0.95,
                warm: 0.9,
                cold: 0.3,
                rain: 0.4
            },
            bodyTypeFit: {
                lean: 0.95,
                average: 0.9,
                larger: 0.75
            },
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "Divergent 2-in-1 Running Short",
            brand: "Expntl Athletics",
            genderTarget: "women",
            category: "bottom",
            subcategory: "shorts",
            priceRange: "mid",
            tags: ["training", "breathable", "lightweight", "anti-chafe", "everyday-run", "built-in-liner"],
            weatherSuitability: {
                hot: 0.9,
                warm: 0.85,
                cold: 0.4,
                rain: 0.5
            },
            bodyTypeFit: {
                lean: 0.9,
                average: 0.9,
                larger: 0.8
            },
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "Faster Than Light Legging",
            brand: "Expntl Athletics",
            genderTarget: "women",
            category: "bottom",
            subcategory: "legging",
            priceRange: "mid",
            tags: ["ultralight", "race", "breathable", "tempo", "built-in-liner", "anti-chafe", "performance-fit"],
            weatherSuitability: {
                hot: 0.7,
                warm: 0.8,
                cold: 0.9,
                rain: 0.8
            },
            bodyTypeFit: {
                lean: 0.95,
                average: 0.9,
                larger: 0.75
            }, 
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "Superbeam Half Tight",
            brand: "Bandit",
            genderTarget: "men",
            category: "bottom",
            subcategory: "half-tights",
            priceRange: "premium",
            tags: ["race-day", "compression", "anti-chafe", "breathable", "lightweight"],
            weatherSuitability: {
                hot: 0.7,
                warm: 0.8,
                cold: 0.9,
                rain: 0.8
            },
            bodyTypeFit: {
                lean: 0.95,
                average: 0.9,
                larger: 0.75
            },
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "Micromesh Run Tee",
            brand: "Bandit",
            genderTarget: "unisex",
            category: "top",
            subcategory: "tee",
            priceRange: "mid",
            tags: ["training", "breathable", "lightweight", "anti-chafe", "everyday-run", "soft-feel"],
            weatherSuitability: {
                hot: 0.9,
                warm: 0.9,
                cold: 0.5,
                rain: 0.4
            },
            bodyTypeFit: {
                lean: 0.9,
                average: 0.9,
                larger: 0.9
            },
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "AFO Split Short Ultra",
            brand: "Janji",
            genderTarget: "unisex",
            category: "bottom",
            subcategory: "shorts",
            priceRange: "mid",
            tags: ["ultralight", "race", "breathable", "tempo", "built-in-liner", "anti-chafe", "performance-fit"],
            weatherSuitability: {
                hot: 0.95,
                warm: 0.9,
                cold: 0.3,
                rain: 0.4
            },
            bodyTypeFit: {
                lean: 0.95,
                average: 0.9,
                larger: 0.75
            },
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "EZ Tee Perf",
            brand: "Rabbit",
            genderTarget: "unisex",
            category: "top",
            subcategory: "tee",
            priceRange: "mid",
            tags: ["training", "breathable", "lightweight", "anti-chafe", "everyday-run"],
            weatherSuitability: {
                hot: 0.9,
                warm: 0.85,
                cold: 0.4,
                rain: 0.5
            },
            bodyTypeFit: {
                lean: 0.9, 
                average: 0.9,
                larger: 0.8
            },
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "Track Girl Pocket Sports Bra",
            brand: "Expntl Athletics",
            genderTarget: "women",
            category: "top",
            subcategory: "sports-bra",
            priceRange: "mid",
            tags: ["training", "breathable", "lightweight", "anti-chafe", "everyday-run", "pocket"],
            weatherSuitability: {
                hot: 0.9,
                warm: 0.85,
                cold: 0.4,
                rain: 0.5
            }, 
            bodyTypeFit: {
                lean: 0.9,
                average: 0.9,
                larger: 0.8
            },
            imageUrl: "",
            affiliateUrl: ""
        }, 
        {
            name: "Summer Scrunch Sports Bra",
            brand: "Expntl Athletics",
            genderTarget: "women",
            category: "top",
            subcategory: "sports-bra",
            priceRange: "mid",
            tags: ["training", "breathable", "lightweight", "anti-chafe", "everyday-run", "scrunch-back"],
            weatherSuitability: {
                hot: 0.9,
                warm: 0.85,
                cold: 0.4,
                rain: 0.5
            },
            bodyTypeFit: {
                lean: 0.9,
                average: 0.9,
                larger: 0.8
            },
            imageUrl: "",
            affiliateUrl: ""
        },
        {
            name: "Race Day Sports Bra",
            brand: "Expntl Athletics",
            genderTarget: "women",
            category: "top",
            subcategory: "sports-bra",
            priceRange: "mid",
            tags: ["ultralight", "race", "breathable", "tempo", "anti-chafe", "performance-fit"],
            weatherSuitability: {
                hot: 0.95,
                warm: 0.9,
                cold: 0.3,
                rain: 0.4
            },
            bodyTypeFit: {
                lean: 0.95,
                average: 0.9,
                larger: 0.75
            }, 
            imageUrl: "",
            affiliateUrl: ""
        }
    ]

    await Promise.all(
        gear.map(async (item) => {
            const brand = await prisma.brand.upsert({
                where: { name: item.brand },
                update: {},
                create: { name: item.brand },
            });

            return prisma.gearItem.create({
                data: {
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
            });
        })
    )

    console.log("Gear seed completed!");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });