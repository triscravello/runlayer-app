export type GearSeedCategory = "top" | "bottom" | "accessory";
export type GearSeedPriceRange = "budget" | "mid" | "premium";
export type ProductVariant = {
    label: string;
    gender: "men" | "women" | "unisex";
    affiliateUrl: string;
    imageUrl?: string;
    price?: number;
    sizes?: string[];
};

export type GearSeedItem = {
    name: string;
    brand: string;
    genderTarget: "men" | "women" | "unisex";
    category: GearSeedCategory;
    subcategory: string;
    priceRange: GearSeedPriceRange;
    tags: string[];
    weatherSuitability: {
        hot: number;
        warm: number;
        cold: number;
        rain: number;
    };
    bodyTypeFit: {
        lean: number;
        average: number;
        larger: number;
    };
    variants: ProductVariant[];
};

const baseGearItems: GearSeedItem[] = [
  { name: "Dri-FIT ADV Aeroswift Singlet", brand: "Nike", genderTarget: "unisex", category: "top", subcategory: "singlet", priceRange: "premium", tags: ["race-day", "tempo", "intervals", "speedwork", "ultralight", "breathable"], weatherSuitability: { hot: 0.96, warm: 0.9, cold: 0.3, rain: 0.35 }, bodyTypeFit: { lean: 0.95, average: 0.9, larger: 0.82 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Micromesh Tee", brand: "Bandit", genderTarget: "unisex", category: "top", subcategory: "tee", priceRange: "mid", tags: ["tempo", "intervals", "speedwork", "training", "daily-run", "moisture-wicking"], weatherSuitability: { hot: 0.89, warm: 0.88, cold: 0.52, rain: 0.48 }, bodyTypeFit: { lean: 0.9, average: 0.9, larger: 0.87 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Harrier Long Sleeve", brand: "Tracksmith", genderTarget: "unisex", category: "top", subcategory: "long-sleeve", priceRange: "premium", tags: ["recovery", "cold-weather", "daily-run", "layering"], weatherSuitability: { hot: 0.25, warm: 0.6, cold: 0.94, rain: 0.75 }, bodyTypeFit: { lean: 0.88, average: 0.9, larger: 0.86 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Track Girl Pocket Sports Bra", brand: "Expntl Athletics", genderTarget: "women", category: "top", subcategory: "sports-bra", priceRange: "mid", tags: ["race-day", "tempo", "anti-chafe", "supportive"], weatherSuitability: { hot: 0.9, warm: 0.86, cold: 0.45, rain: 0.5 }, bodyTypeFit: { lean: 0.92, average: 0.89, larger: 0.85 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Paintbrush Short Sleeve Tee", brand: "ASICS", genderTarget: "unisex", category: "top", subcategory: "tee", priceRange: "budget", tags: ["daily-run", "training", "breathable", "soft-feel"], weatherSuitability: { hot: 0.85, warm: 0.82, cold: 0.5, rain: 0.52 }, bodyTypeFit: { lean: 0.89, average: 0.9, larger: 0.9 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Hyper-Speed Tank", brand: "Expntl Athletics", genderTarget: "women", category: "top", subcategory: "performance-tank", priceRange: "mid", tags: ["race-day", "training", "anti-chafe", "breathable"], weatherSuitability: { hot: 0.94, warm: 0.9, cold: 0.35, rain: 0.42 }, bodyTypeFit: { lean: 0.94, average: 0.9, larger: 0.83 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Divergent Tank", brand: "Expntl Athletics", genderTarget: "women", category: "top", subcategory: "training-tank", priceRange: "mid", tags: ["training", "breathable", "lightweight", "anti-chafe", "everyday-run"], weatherSuitability: { hot: 0.9, warm: 0.85, cold: 0.4, rain: 0.5 }, bodyTypeFit: { lean: 0.9, average: 0.9, larger: 0.8}, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Van Cortlandt Singlet", brand: "Tracksmith", genderTarget: "men", category: "top", subcategory: "singlet", priceRange: "premium", tags: ["race-day", "elite", "lightweight", "breathable"], weatherSuitability: { hot: 0.95, warm: 0.9, cold: 0.2, rain: 0.3 }, bodyTypeFit: { lean: 0.95, average: 0.85, larger: 0.6 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "EZ Tee Perf", brand: "Rabbit", genderTarget: "unisex", category: "top", subcategory: "tee", priceRange: "mid", tags: ["training", "breathable", "lightweight", "anti-chafe", "everyday-run"], weatherSuitability: { hot: 0.9, warm: 0.85, cold: 0.4, rain: 0.5 }, bodyTypeFit: { lean: 0.9, average: 0.9, larger: 0.8 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Summer Scrunch Sports Bra", brand: "Expntl Athletics", genderTarget: "women", category: "top", subcategory: "sports-bra", priceRange: "mid", tags: ["training", "breathable", "lightweight", "anti-chafe", "everyday-run", "scrunch-back"], weatherSuitability: { hot: 0.9, warm: 0.85, cold: 0.4, rain: 0.5 }, bodyTypeFit: { lean: 0.9, average: 0.9, larger: 0.8 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Race Day Sports Bra", brand: "Expntl Athletics", genderTarget: "women", category: "top", subcategory: "sports-bra", priceRange: "mid", tags: ["ultralight", "race", "breathable", "tempo", "anti-chafe", "performance-fit"], weatherSuitability: { hot: 0.95, warm: 0.9, cold: 0.3, rain: 0.4 }, bodyTypeFit: { lean: 0.95, average: 0.9, larger: 0.75 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }]},

  { name: "Dri-FIT ADV Aeroswift Short", brand: "Nike", genderTarget: "unisex", category: "bottom", subcategory: "shorts", priceRange: "mid", tags: ["race-day", "tempo", "intervals", "speedwork", "ultralight", "anti-chafe"], weatherSuitability: { hot: 0.95, warm: 0.9, cold: 0.4, rain: 0.45 }, bodyTypeFit: { lean: 0.93, average: 0.9, larger: 0.84 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Superbeam Half-Tights", brand: "Bandit", genderTarget: "men", category: "bottom", subcategory: "half-tights", priceRange: "premium", tags: ["breathable", "lightweight", "compression", "anti-chafe", "race-day"], weatherSuitability: { hot: 0.78, warm: 0.82, cold: 0.72, rain: 0.62 }, bodyTypeFit: { lean: 0.93, average: 0.9, larger: 0.85 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Trail Tights", brand: "Janji", genderTarget: "unisex", category: "bottom", subcategory: "tights", priceRange: "premium", tags: ["rain-ready", "cold-weather", "training", "daily-run"], weatherSuitability: { hot: 0.22, warm: 0.48, cold: 0.94, rain: 0.92 }, bodyTypeFit: { lean: 0.9, average: 0.9, larger: 0.88 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Hawaiian Split Shorts", brand: "ChicknLegs", genderTarget: "unisex", category: "bottom", subcategory: "shorts", priceRange: "budget", tags: ["daily-run", "training", "hot-weather", "lightweight"], weatherSuitability: { hot: 0.92, warm: 0.88, cold: 0.42, rain: 0.46 }, bodyTypeFit: { lean: 0.88, average: 0.9, larger: 0.89 }, variants: [{ label: "Women's 1.5\" Split Shorts", gender: "women", affiliateUrl: "https://www.chicknlegs.com/products/womens-hawaiian-1-5-split-shorts?_pos=1&_sid=e76e6db5c&_ss=r", imageUrl: "" }, { label: "Men's 4\" Half Split Shorts", gender: "men", affiliateUrl: "https://www.chicknlegs.com/products/mens-hawaiian-4-half-split-shorts?_pos=3&_sid=9ab438657&_ss=r", imageUrl: "" }] },
  { name: "Faster than Light Shorts", brand: "Expntl Athletics", genderTarget: "women", category: "bottom", subcategory: "shorts", priceRange: "mid", tags: ["race-day", "tempo", "intervals", "speedwork", "pocket"], weatherSuitability: { hot: 0.8, warm: 0.83, cold: 0.7, rain: 0.68 }, bodyTypeFit: { lean: 0.94, average: 0.9, larger: 0.86 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Performance Tights Winter", brand: "On", genderTarget: "unisex", category: "bottom", subcategory: "tights", priceRange: "premium", tags: ["cold-weather", "recovery", "daily-run", "wind-resistant"], weatherSuitability: { hot: 0.16, warm: 0.45, cold: 0.97, rain: 0.8 }, bodyTypeFit: { lean: 0.88, average: 0.9, larger: 0.87 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Divergent 2-in-1 Running Short", brand: "Expntl Athletics", genderTarget: "women", category: "bottom", subcategory: "shorts", priceRange: "mid", tags: ["training", "breathable", "lightweight", "anti-chafe", "everyday-run", "built-in-liner"], weatherSuitability: { hot: 0.9, warm: 0.85, cold: 0.4, rain: 0.5 }, bodyTypeFit: { lean: 0.9, average: 0.9, larger: 0.8 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Faster Than Light Legging", brand: "Expntl Athletics", genderTarget: "women", category: "bottom", subcategory: "legging", priceRange: "mid", tags: ["ultralight", "race", "breathable", "tempo", "built-in-liner", "anti-chafe", "performance-fit"], weatherSuitability: { hot: 0.7, warm: 0.8, cold: 0.9, rain: 0.8 }, bodyTypeFit: { lean: 0.95, average: 0.9, larger: 0.75 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "AFO Split Short Ultra", brand: "Janji", genderTarget: "unisex", category: "bottom", subcategory: "shorts", priceRange: "mid", tags: ["ultralight", "race", "breathable", "tempo", "built-in-liner", "anti-chafe", "performance-fit"], weatherSuitability: { hot: 0.95, warm: 0.9, cold: 0.3, rain: 0.4 }, bodyTypeFit: { lean: 0.95,average: 0.9, larger: 0.75 },variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },

  { name: "ATC Performance Running Cap", brand: "ASICS", genderTarget: "unisex", category: "accessory", subcategory: "cap", priceRange: "budget", tags: ["hot-weather", "race-day", "daily-run", "sun-protection"], weatherSuitability: { hot: 0.93, warm: 0.88, cold: 0.35, rain: 0.4 }, bodyTypeFit: { lean: 0.92, average: 0.92, larger: 0.92 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Zephyrunner Wind Shell", brand: "Janji", genderTarget: "unisex", category: "accessory", subcategory: "jacket", priceRange: "premium", tags: ["rain-ready", "training", "daily-run", "packable"], weatherSuitability: { hot: 0.2, warm: 0.55, cold: 0.9, rain: 0.96 }, bodyTypeFit: { lean: 0.9, average: 0.9, larger: 0.88 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Inverno Arm Warmers", brand: "Tracksmith", genderTarget: "unisex", category: "accessory", subcategory: "sleeves", priceRange: "budget", tags: ["cold-weather", "tempo", "layering", "recovery"], weatherSuitability: { hot: 0.15, warm: 0.5, cold: 0.92, rain: 0.68 }, bodyTypeFit: { lean: 0.9, average: 0.9, larger: 0.9 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "Flipbelt Classic Running Belt", brand: "Flipbelt", genderTarget: "unisex", category: "accessory", subcategory: "belt", priceRange: "budget", tags: ["race-day", "tempo", "intervals", "daily-run", "storage"], weatherSuitability: { hot: 0.86, warm: 0.84, cold: 0.6, rain: 0.7 }, bodyTypeFit: { lean: 0.9, average: 0.9, larger: 0.9 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "SpeedDraw 2 Insulated Flask 12oz", brand: "NATHAN", genderTarget: "unisex", category: "accessory", subcategory: "hydration", priceRange: "mid", tags: ["training", "daily-run", "recovery", "long-run"], weatherSuitability: { hot: 0.91, warm: 0.87, cold: 0.55, rain: 0.62 }, bodyTypeFit: { lean: 0.9, average: 0.9, larger: 0.9 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] },
  { name: "EZ Gloves", brand: "Rabbit", genderTarget: "unisex", category: "accessory", subcategory: "gloves", priceRange: "budget", tags: ["cold-weather", "daily-run", "training", "night-safe"], weatherSuitability: { hot: 0.1, warm: 0.38, cold: 0.95, rain: 0.72 }, bodyTypeFit: { lean: 0.9, average: 0.9, larger: 0.9 }, variants: [{ label: "Default", gender: "unisex", affiliateUrl: "", imageUrl: "" }] }
];

const variantSuffixes = ["I", "II", "III"];

export function generateGearVariants(baseItem: GearSeedItem): GearSeedItem[] {
    return variantSuffixes.map((suffix, index) => ({
        ...baseItem,
        name: `${baseItem.name} ${suffix}`,
        weatherSuitability: {
            hot: Math.max(0, Math.min(1, baseItem.weatherSuitability.hot - index * 0.02)),
            warm: Math.max(0, Math.min(1, baseItem.weatherSuitability.warm - index * 0.01)),
            cold: Math.max(0, Math.min(1, baseItem.weatherSuitability.cold + index * 0.02)),
            rain: Math.max(0, Math.min(1, baseItem.weatherSuitability.rain + index * 0.02)),
        },
    }));
}

export function loadGearSeedData(): GearSeedItem[] {
    return baseGearItems.flatMap((item) => generateGearVariants(item));
}