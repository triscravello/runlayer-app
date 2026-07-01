import { z } from "zod";
import { createGearItemSchema, type CreateGearItemPayload } from "@/lib/validation/adminGear";
import type { BrandRow } from "@/lib/db/brandRepository";

const optionalString = z.string().trim().optional().nullable();
const numberString = z.union([z.number(), z.string().trim()]).optional().nullable();

const importRowSchema = z.object({
  name: z.string().trim().min(1),
  brandId: optionalString,
  brand: optionalString,
  category: z.enum(["TOP", "BOTTOM", "ACCESSORY"]),
  priceRange: z.enum(["BUDGET", "MID", "PREMIUM"]),
  genderTarget: optionalString,
  subcategory: optionalString,
  tags: z.union([z.array(z.string()), z.string()]).optional(),
  bodyTypeFit: z.union([z.array(z.string()), z.string()]).optional(),
  imageUrl: optionalString,
  affiliateUrl: optionalString,
  weatherHot: numberString,
  weatherCold: numberString,
  weatherRain: numberString,
  weatherWind: numberString,
});

export type GearImportRowPreview = {
  row: number;
  name: string;
  brand: string;
  category: string;
  priceRange: string;
  status: "valid" | "invalid";
  errors: string[];
};

export type GearBulkImportValidation = {
  parsedRows: number;
  validRows: number;
  invalidRows: number;
  rows: GearImportRowPreview[];
  validItems: CreateGearItemPayload[];
};

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value !== "string") return [];

  return value.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
}

function parseWeatherScore(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
}

export function validateBulkGearImportRows(rawRows: unknown[], brands: BrandRow[]): GearBulkImportValidation {
  const brandsById = new Map(brands.map((brand) => [brand.id, brand]));
  const brandsByName = new Map(brands.map((brand) => [brand.name.toLowerCase(), brand]));
  const rows: GearImportRowPreview[] = [];
  const validItems: CreateGearItemPayload[] = [];

  rawRows.forEach((rawRow, index) => {
    const rowNumber = index + 1;
    const parsed = importRowSchema.safeParse(rawRow);

    if (!parsed.success) {
      rows.push({ row: rowNumber, name: "", brand: "", category: "", priceRange: "", status: "invalid", errors: formatZodIssues(parsed.error) });
      return;
    }

    const importRow = parsed.data;
    const errors: string[] = [];
    const matchedBrand = importRow.brandId ? brandsById.get(importRow.brandId) : importRow.brand ? brandsByName.get(importRow.brand.toLowerCase()) : null;

    if (!matchedBrand) {
      errors.push(importRow.brandId || importRow.brand ? "Brand reference does not match an existing brand" : "brandId or brand is required");
    }

    const weatherSuitability = {
      hot: parseWeatherScore(importRow.weatherHot),
      cold: parseWeatherScore(importRow.weatherCold),
      rain: parseWeatherScore(importRow.weatherRain),
      wind: parseWeatherScore(importRow.weatherWind),
    };

    for (const [key, value] of Object.entries(weatherSuitability)) {
      if (value === null) errors.push(`${key} weather score must be a number between 0 and 1`);
    }

    const candidate = {
      name: importRow.name,
      brandId: matchedBrand?.id ?? "missing-brand",
      category: importRow.category,
      priceRange: importRow.priceRange,
      genderTarget: importRow.genderTarget || null,
      subcategory: importRow.subcategory || null,
      tags: parseList(importRow.tags),
      bodyTypeFit: parseList(importRow.bodyTypeFit),
      imageUrl: importRow.imageUrl || null,
      affiliateUrl: importRow.affiliateUrl || null,
      weatherSuitability: {
        hot: weatherSuitability.hot ?? undefined,
        cold: weatherSuitability.cold ?? undefined,
        rain: weatherSuitability.rain ?? undefined,
        wind: weatherSuitability.wind ?? undefined,
      },
    };

    const validated = createGearItemSchema.safeParse(candidate);
    if (!validated.success) errors.push(...formatZodIssues(validated.error));

    const status = errors.length ? "invalid" : "valid";
    rows.push({ row: rowNumber, name: importRow.name, brand: matchedBrand?.name ?? importRow.brand ?? importRow.brandId ?? "", category: importRow.category, priceRange: importRow.priceRange, status, errors });
    if (status === "valid" && validated.success) validItems.push(validated.data);
  });

  return {
    parsedRows: rawRows.length,
    validRows: validItems.length,
    invalidRows: rows.length - validItems.length,
    rows,
    validItems,
  };
}