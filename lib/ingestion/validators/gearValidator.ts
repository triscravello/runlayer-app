import { Category, PriceRange } from "@prisma/client";
import { BRAND_FAILURE, checkBrandText } from "../brandResolution";

const validCategories = new Set(Object.values(Category));
const validPriceRanges = new Set(Object.values(PriceRange));

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlank(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

// Rows come straight from JSON, so every field is untrusted. Anything malformed becomes a row-level error message
// (never a thrown exception that would abort the whole import), and messages never echo the offending value.
export function validateGearItem(input: unknown): string[] {
    if (!isRecord(input)) return ["item must be an object"];

    const errors: string[] = [];

    if (typeof input.name !== "string" || !input.name.trim()) errors.push("name is required");

    const brandAbsent = isBlank(input.brand);
    const brandIdAbsent = isBlank(input.brandId);
    if (brandAbsent && brandIdAbsent) errors.push("brand or brandId is required");
    if (!brandAbsent && !checkBrandText(input.brand).ok) errors.push(BRAND_FAILURE.invalidName);
    if (!brandIdAbsent && !checkBrandText(input.brandId).ok) errors.push(BRAND_FAILURE.invalidId);

    if (typeof input.category !== "string" || !input.category.trim()) {
        errors.push("category is required");
    } else if (!validCategories.has(input.category.trim().toUpperCase() as Category)) {
        errors.push("invalid category");
    }

    if (typeof input.price !== "number" && !input.priceRange) errors.push("price or priceRange is required");

    if (input.priceRange !== undefined && input.priceRange !== null && input.priceRange !== "") {
        if (typeof input.priceRange !== "string" || !validPriceRanges.has(input.priceRange.trim().toUpperCase() as PriceRange)) {
            errors.push("invalid priceRange");
        }
    }

    if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== "string"))) {
        errors.push("tags must be an array of strings");
    }

    for (const field of ["subcategory", "imageUrl", "affiliateUrl"] as const) {
        const value = input[field];
        if (value !== undefined && value !== null && typeof value !== "string") errors.push(`${field} must be a string`);
    }

    return errors;
}
