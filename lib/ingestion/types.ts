import type { Category, PriceRange } from "@prisma/client";

export type RawGearItemInput = {
    externalId?: string;
    name: string;
    brand: string;
    brandId?: string;
    category: string;
    subcategory?: string;
    price?: number;
    priceRange?: string;
    tags?: string[];
    conditions?: string[];
    intensity?: string[];
    imageUrl?: string;
    affiliateUrl: string;
}

export type NormalizedGearItem = {
    externalId?: string;
    name: string;
    brandId?: string;
    category: Category;
    subcategory?: string | null;
    priceRange?: PriceRange;
    tags?: string[];
    bodyTypeFit: string[];
    imageUrl?: string | null;
    affiliateUrl: string | null;
    slug: string;
};

export type GearImportResult = {
    processed: number;
    inserted: number;
    updated: number;
    failed: Array<{ name: string; reason: string }>;
}