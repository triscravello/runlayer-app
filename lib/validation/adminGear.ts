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

export const updateGearItemSchema = baseGearWriteSchema.partial().refine(
    (value) => Object.keys(value).length > 0,
    { message: "At least one gear field is required" },
);

export const importGearItemsSchema = z.array(createGearItemSchema).min(1, "Import payload must include at least 1 item");

export type CreateGearItemPayload = z.infer<typeof createGearItemSchema>;
export type UpdateGearItemPayload = z.infer<typeof updateGearItemSchema>;
export type ImportGearItemsPayload = z.infer<typeof importGearItemsSchema>;
