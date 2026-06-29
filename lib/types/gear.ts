// lib/types/gear.ts
export type Category = "top" | "bottom" | "shoes" | "accessory";
export type PriceRange = "budget" | "mid" | "premium";
export type WeatherCondition = "hot" | "warm" | "cold" | "rain" | "wind";
export type BodyType = "slim" | "athletic" | "broad" | "plus";
export type BrandTier = "entry" | "mid" | "elite";

export interface ProductVariant {
    id?: string;
    label: string;
    gender: "men" | "women" | "unisex";
    affiliateUrl?: string | null;
    imageUrl?: string | null;
    price?: number | null;
    sizes?: string[];
}

export interface Gear {
    id: string;
    name: string;
    brandId: string;
    brand?: Brand;

    category: Category;
    subcategory: string;

    priceRange: PriceRange;

    tags: string[];

    weatherSuitability: Record<WeatherCondition, number>;
    bodyTypeFit: BodyType[];

    imageUrl: string;
    affiliateUrl: string;
    variants?: ProductVariant[];

    rating?: number;
    reviewCount?: number;
    isSponsored?: boolean;

    createdAt: Date;
    updatedAt: Date;
}

export interface Brand {
    id: string;
    name: string;
    tier: BrandTier;
    style: string;

    createdAt: Date;
    updatedAt: Date;
}