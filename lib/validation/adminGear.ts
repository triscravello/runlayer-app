import { z } from "zod";
import { isSafeHttpUrl } from "@/lib/gear/externalUrl";

const categorySchema = z.enum(["TOP", "BOTTOM", "ACCESSORY"]);
const priceRangeSchema = z.enum(["BUDGET", "MID", "PREMIUM"]);

const trimmedString = z.string().trim();
// Affiliate links that will be shown as shopping links use the one shared policy (lib/gear/externalUrl.ts): http(s) only, scheme
// case-insensitive, no credentials, whitespace or control characters, at most 2048 characters. Invalid values are rejected, never
// silently sanitized.
const AFFILIATE_URL_MESSAGE = "Affiliate URL must be a valid http:// or https:// link";
// A variant's link: blank (or whitespace only) means "no link" and is stored as null; anything else must pass the policy exactly
// as submitted. It is deliberately NOT trimmed first: a padded, nonblank value contains whitespace and is rejected, never
// quietly turned into a valid link.
const variantAffiliateUrlSchema = z
  .string()
  .nullable()
  .default(null)
  .transform((value) => (value === null || value.trim() === "" ? null : value))
  .refine((value) => value === null || isSafeHttpUrl(value), AFFILIATE_URL_MESSAGE);
// Item-level link on CREATE (and bulk import). The update schema deliberately keeps its existing, narrower item-level check, so a
// legacy record whose stored item link is unsafe can still be edited: an update never re-validates what it does not change.
const createAffiliateUrlSchema = z.string().refine(isSafeHttpUrl, AFFILIATE_URL_MESSAGE).nullable().default(null); // not trimmed: see above
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
    affiliateUrl: variantAffiliateUrlSchema,
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
    affiliateUrl: createAffiliateUrlSchema,
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

// Optional optimistic-concurrency token: the item's `version` exactly as the caller last read it. A plain integer in the range of the
// 32-bit signed `gear_items.version` column; nothing is coerced (strings, null, floats, negatives and out-of-range numbers are refused).
// It is a condition on the write, never a gear field, so it does not count as a change by itself.
const expectedVersionSchema = z.number().int().min(0).max(2_147_483_647);

const updateFieldsSchema = z.strictObject({
    id: trimmedString.min(1).optional(),
    externalId: trimmedString.min(1).optional(),
    expectedVersion: expectedVersionSchema.optional(),
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

const NON_CHANGE_KEYS = new Set(["id", "externalId", "expectedVersion"]);

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
