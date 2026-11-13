import { z } from "zod";

const categorySchema = z.enum(["TOP", "BOTTOM", "ACCESSORY"]);
const priceRangeSchema = z.enum(["BUDGET", "MID", "PREMIUM"]);

const trimmedString = z.string().trim();
const nullableStringWithDefault = trimmedString.nullable().default(null);
const httpUrlSchema = trimmedString
  .url()
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "URL must start with http:// or https://",
  );
const nullableUrlWithDefault = httpUrlSchema.nullable().default(null);
const optionalNullableUrl = httpUrlSchema.optional().nullable();
const optionalNullableString = trimmedString.optional().nullable();
const stringListSchema = z.array(trimmedString.min(1)).default([]);
const weatherScoreSchema = z.number().min(0).max(1).nullable();

const productVariantSchema = z.object({
    label: trimmedString.min(1),
    gender: z.enum(["men", "women", "unisex"]),
    affiliateUrl: nullableStringWithDefault,
    imageUrl: optionalNullableUrl,
    price: z.number().min(0).optional().nullable(),
    sizes: stringListSchema.optional(),
});

const weatherSuitabilitySchema = z.object({
    hot: weatherScoreSchema.optional(),
    cold: weatherScoreSchema.optional(),
    rain: weatherScoreSchema.optional(),
    wind: weatherScoreSchema.optional(),
}).partial();

const baseGearWriteSchema = z.object({
    id: trimmedString.min(1).optional(),
    externalId: trimmedString.min(1).optional(),
    name: trimmedString.min(1),
    brandId: trimmedString.min(1),
    category: categorySchema,
    priceRange: priceRangeSchema,
    genderTarget: optionalNullableString,
    subcategory: optionalNullableString,
    tags: stringListSchema.optional(),
    bodyTypeFit: stringListSchema.optional(),
    imageUrl: nullableUrlWithDefault,
    affiliateUrl: nullableUrlWithDefault,
    variants: z.array(productVariantSchema).optional(),
    weatherSuitability: weatherSuitabilitySchema.optional(),
});

export const createGearItemSchema = baseGearWriteSchema;

// PATCH semantics: a key that is absent means "leave the stored value alone", so none of these fields carries a default
// (the create schema's defaults would silently reset tags, images and URLs). `null` and `[]` are explicit clears.
// Unknown keys are rejected, at every level, rather than stripped. `id` and `externalId` are accepted so a client may echo
// a record back, but they never count as a change; the route rejects an `id` that disagrees with the URL.
const bareStringList = z.array(trimmedString.min(1));
const bareNullableUrl = httpUrlSchema.nullable();

const updateFieldsSchema = z.strictObject({
    id: trimmedString.min(1).optional(),
    externalId: trimmedString.min(1).optional(),
    name: trimmedString.min(1).optional(),
    brandId: trimmedString.min(1).optional(),
    category: categorySchema.optional(),
    priceRange: priceRangeSchema.optional(),
    genderTarget: optionalNullableString,
    subcategory: optionalNullableString,
    tags: bareStringList.optional(),
    bodyTypeFit: bareStringList.optional(),
    imageUrl: bareNullableUrl.optional(),
    affiliateUrl: bareNullableUrl.optional(),
    variants: z.array(productVariantSchema.strict()).optional(),
    weatherSuitability: weatherSuitabilitySchema.strict().optional(),
});

const NON_CHANGE_KEYS = new Set(["id", "externalId"]);

function hasMeaningfulChange(value: Record<string, unknown>): boolean {
    return Object.entries(value).some(([key, field]) => {
        if (field === undefined || NON_CHANGE_KEYS.has(key)) return false;
        if (key === "weatherSuitability") return Object.values(field as Record<string, unknown>).some((score) => score !== undefined);
        return true;
    });
}

export const updateGearItemSchema = updateFieldsSchema.refine(hasMeaningfulChange, { message: "At least one gear field is required" });

export const importGearItemsSchema = z.array(createGearItemSchema).min(1, "Import payload must include at least 1 item");

export type CreateGearItemPayload = z.infer<typeof createGearItemSchema>;
export type UpdateGearItemPayload = z.infer<typeof updateGearItemSchema>;
export type ImportGearItemsPayload = z.infer<typeof importGearItemsSchema>;
