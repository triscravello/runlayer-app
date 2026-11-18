import { containGearItemLinks } from "./productVariant";

// The public catalog response (GET /api/gear), shaped EXPLICITLY. Each object is rebuilt from an allow-list of the columns that were
// public before `version` existed, so the response fails closed: an internal column such as `version`, or any column added to the
// model later, can not reach the public JSON through a spread or through a nested brand/variant object until it is listed here on
// purpose. Unsafe affiliate links are still contained first (see containGearItemLinks); stored rows are never modified.
const ITEM_FIELDS = [
    "id", "name", "brandId", "genderTarget", "category", "subcategory", "priceRange", "tags",
    "weatherHot", "weatherCold", "weatherRain", "weatherWind", "bodyTypeFit", "imageUrl", "affiliateUrl", "createdAt", "updatedAt",
] as const;
const BRAND_FIELDS = ["id", "name", "normalizedName", "tier", "style", "createdAt", "updatedAt"] as const;
const VARIANT_FIELDS = ["id", "gearItemId", "label", "gender", "affiliateUrl", "imageUrl", "price", "sizes", "createdAt", "updatedAt"] as const;

type Row = Record<string, unknown>;

function pick(source: Row, fields: readonly string[]): Row {
    const picked: Row = {};
    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) picked[field] = source[field];
    }
    return picked;
}

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);

/** One catalog row as the public API returns it: links contained, only allow-listed fields, nested brand and variants allow-listed too. */
export function toPublicGearItem(item: object): Row {
    // Non-object variants are dropped BEFORE containment (which expects objects), so a malformed row can neither crash nor pass through.
    const source = item as Row;
    const prepared = Array.isArray(source.variants) ? { ...source, variants: source.variants.filter(isRow) } : source;
    const contained = containGearItemLinks(prepared as { affiliateUrl?: string | null; variants?: Array<{ affiliateUrl?: string | null }> | null }) as Row;
    const result = pick(contained, ITEM_FIELDS);
    if (isRow(contained.brand)) result.brand = pick(contained.brand, BRAND_FIELDS);
    else if (contained.brand === null) result.brand = null;
    if (Array.isArray(contained.variants)) result.variants = contained.variants.map((variant) => pick(variant, VARIANT_FIELDS));
    return result;
}
