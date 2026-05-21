import { Category, PriceRange } from "@prisma/client";
import type { RawGearItemInput } from "../types";

const validCategories = new Set(Object.values(Category));
const validPriceRanges = new Set(Object.values(PriceRange));

export function validateGearItem(input: RawGearItemInput): string[] {
    const errors: string[] = [];

    if (!input.name?.trim()) errors.push("name is required");
    if (!input.brand?.trim() && !input.brandId?.trim()) errors.push("brand or brandId is required");
    if (!input.category?.trim()) errors.push("category is required"); 
    if (typeof input.price !== "number" && !input.priceRange) errors.push("price or priceRange is required");

    if (input.tags && (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== "string"))) {
        errors.push("tags must be an array of strings");
    }

    const normalizedCategory = input.category?.trim().toUpperCase();
    if (normalizedCategory && !validCategories.has(normalizedCategory as Category)) {
        errors.push(`invalid category: ${input.category}`);
    }

    const normalizedRange = input.priceRange?.trim().toUpperCase();
    if (normalizedRange && !validPriceRanges.has(normalizedRange as PriceRange)) {
        errors.push(`invalid priceRange: ${input.priceRange}`);
    }

    return errors;
}