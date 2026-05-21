import { Category, PriceRange } from "@prisma/client";
import type { NormalizedGearItem, RawGearItemInput } from "../types";

function slugify(value: string): string {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizeCategory(category: string): Category {
    return category.trim().toUpperCase() as Category;
}

function normalizePriceRange(item: RawGearItemInput): PriceRange {
    const price = item.price ?? 0;
    if (price < 60) return PriceRange.BUDGET;
    if (price < 150) return PriceRange.MID;
    return PriceRange.PREMIUM;
}

export function mapGearItem(input: RawGearItemInput): NormalizedGearItem {
    const name = input.name.trim();
    const brandId = (input.brandId ?? input.brand).trim();
    const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];

    return {
        externalId: input.externalId,
        name,
        brandId,
        category: normalizeCategory(input.category),
        subcategory: input.subcategory?.trim() || null,
        priceRange: normalizePriceRange(input),
        tags,
        bodyTypeFit: [],
        imageUrl: input.imageUrl?.trim() || null,
        affiliateUrl: input.affiliateUrl?.trim() || null,
        slug: slugify(`${name}-${brandId}`),
    };
}