// Limits and kit types shared by the outfit request schemas, the outfit repository and the saved-kit editor.
// Plain constants and pure functions only (no zod, no database) so a client component can import it cheaply.

export const OUTFIT_NAME_MAX_LENGTH = 120;
export const OUTFIT_DESCRIPTION_MAX_LENGTH = 1000;
export const OUTFIT_MAX_GEAR_ITEMS = 30;
export const OUTFIT_ID_MAX_LENGTH = 64;

export const KIT_TYPES = ["race-day", "intervals", "long-run", "trail", "rain", "cold-weather", "summer", "favorites", "training", "custom"] as const;
export type KitType = (typeof KIT_TYPES)[number];

const KIT_TYPE_SET: ReadonlySet<string> = new Set(KIT_TYPES);

/**
 * The canonical kit type for a supported value, or null for anything else. The legacy spelling "race_day" is
 * accepted and normalized to "race-day". Unknown values are NOT coerced to a default: callers must reject them.
 */
export function normalizeKitType(value: string): KitType | null {
    const trimmed = value.trim();
    const canonical = trimmed === "race_day" ? "race-day" : trimmed;
    return KIT_TYPE_SET.has(canonical) ? (canonical as KitType) : null;
}
