import { Category, PriceRange } from "@prisma/client";
import type { BrandReference } from "../brandResolution";
import type { NormalizedGearItem, RawGearItemInput } from "../types";

function normalizeCategory(category: string): Category {
    return category.trim().toUpperCase() as Category;
}

function normalizePriceRange(item: RawGearItemInput): PriceRange {
    const price = item.price ?? 0;
    if (price < 60) return PriceRange.BUDGET;
    if (price < 150) return PriceRange.MID;
    return PriceRange.PREMIUM;
}

function textOrNull(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

// The mapper only RECORDS what the row says about its brand. It must never put a brand name into a field that is
// a database id: resolving the reference to a real brands.id is the job of brandResolution / brandStore.
export function mapBrandReference(input: Pick<RawGearItemInput, "brand" | "brandId">): BrandReference {
    return { id: textOrNull(input.brandId), name: textOrNull(input.brand) };
}

export function mapGearItem(input: RawGearItemInput): NormalizedGearItem {
    const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];

    return {
        externalId: input.externalId,
        name: input.name.trim(),
        brandRef: mapBrandReference(input),
        category: normalizeCategory(input.category),
        subcategory: input.subcategory?.trim() || null,
        priceRange: normalizePriceRange(input),
        tags,
        bodyTypeFit: [],
        imageUrl: input.imageUrl?.trim() || null,
        affiliateUrl: input.affiliateUrl?.trim() || null,
    };
}
