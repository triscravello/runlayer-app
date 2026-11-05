import type { Category, PriceRange } from "@prisma/client";
import type { BrandReference } from "./brandResolution";

export type ProductVariantInput = { label: string; gender: "men" | "women" | "unisex"; affiliateUrl?: string | null; imageUrl?: string | null; price?: number | null; sizes?: string[]; };

export type RawGearItemInput = {
    externalId?: string;
    name: string;
    brand?: string;
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
    variants: ProductVariantInput[];
}

export type NormalizedGearItem = {
    externalId?: string;
    name: string;
    // A reference to resolve against the database. Never a database id by itself (see brandResolution.ts).
    brandRef: BrandReference;
    category: Category;
    subcategory?: string | null;
    priceRange: PriceRange;
    tags?: string[];
    bodyTypeFit: string[];
    imageUrl?: string | null;
    affiliateUrl: string | null;
    variants?: ProductVariantInput[];
};

export type GearImportResult = {
    processed: number;
    inserted: number;
    updated: number;
    failed: Array<{ name: string; reason: string }>;
}