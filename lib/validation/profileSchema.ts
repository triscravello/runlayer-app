import { z } from "zod";

export const bodyTypeSchema = z.enum(["SLIM", "ATHLETIC", "BROAD", "PLUS"]);
export const preferredFitSchema = z.enum(["slim", "regular", "relaxed"]);
export const genderPreferenceSchema = z.enum(["male", "female", "non_binary", "prefer_not_to_say"]);
export const heatSensitivitySchema = z.enum(["low", "medium", "high"]);
export const heatToleranceSchema = z.enum(["low", "medium", "high"]);
export const coldToleranceSchema = z.enum(["low", "medium", "high"]);
export const stylePreferenceSchema = z.enum(["performance", "casual", "minimal", "bold", "classic"]);
export const budgetLevelSchema = z.enum(["BUDGET", "MID", "PREMIUM"]);
export const budgetSensitivitySchema = z.enum(["low", "medium", "high"]);
export const terrainPreferenceSchema = z.enum(["mixed", "road", "trail"]);

export const MAX_PROFILE_BRANDS = 12;
export const MAX_PROFILE_BRAND_NAME_LENGTH = 40;

const optionalPositiveNumber = z.preprocess(
    (value) => {
        if (value === "" || value === null || typeof value === "undefined") return undefined;
        return typeof value === "string" ? Number(value) : value;
    },
    z.number().finite().positive().optional(),
);

const brandListSchema = z.preprocess(
    (value) => {
        const rawBrands = Array.isArray(value) ? value: typeof value === "string" ? value.split(",") : [];
        const seen = new Set<string>();

        return rawBrands.reduce<string[]>((brands, brand) => {
            if (typeof brand !== "string") return brands;

            const trimmedBrand = brand.trim();
            const normalizedBrand = trimmedBrand.toLocaleLowerCase();

            if (!trimmedBrand || seen.has(normalizedBrand)) return brands;

            seen.add(normalizedBrand);
            brands.push(trimmedBrand);
            return brands;
        }, []);
    }, z.array(z.string().max(MAX_PROFILE_BRAND_NAME_LENGTH, `Brand names must be ${MAX_PROFILE_BRAND_NAME_LENGTH} characters or fewer.`)).max(MAX_PROFILE_BRANDS, `Enter ${MAX_PROFILE_BRANDS} or fewer`).optional().default([])
);

export const profileSchema = z.object({
    location: z.string().trim().max(120).nullable().optional(),
    heightCm: optionalPositiveNumber.refine((value) => value === undefined || (value >= 90 && value <= 260), {
        message: "Height must be between 90 and 260 cm.",
    }),
    weightLbs: optionalPositiveNumber.refine((value) => value === undefined || (value >= 50 && value <= 700), {
        message: "Weight must be between 50 and 700 lbs",
    }),
    bodyType: z.preprocess((value) => (value === "" ? undefined: value), bodyTypeSchema.optional()),
    genderPreference: z.preprocess((value) => (value === "" ? undefined : value), genderPreferenceSchema.optional()),
    preferredFit: preferredFitSchema.default("regular"),
    heatSensitivity: heatSensitivitySchema.default("medium"),
    heatTolerance: heatToleranceSchema.default("medium"),
    coldTolerance: coldToleranceSchema.default("medium"),
    chafeProne: z.boolean().default(false),
    stylePreference: stylePreferenceSchema.default("performance"),
    budgetLevel: budgetLevelSchema.default("MID"),
    budgetSensitivity: budgetSensitivitySchema.default("medium"),
    terrainPreference: terrainPreferenceSchema.default("mixed"),
    preferredBrands: brandListSchema,
    avoidedBrands: brandListSchema,
});

export type UserProfilePayload = z.infer<typeof profileSchema>;