import { toDate, type SerializableDate } from "@/lib/utils/date";

// Pure model for the admin gear editor: the item and form field types, the field <-> item mapping, local validation, the request payload,
// version validation and the merge of a saved/latest server item into a catalog entry. No React, no network: everything here is tested
// directly. (Moved out of GearEditor.tsx; the field helpers are unchanged.)

export type GearEditorItem = {
  id: string;
  name: string;
  brandId: string;
  brand?: { name?: string | null } | null;
  category: "TOP" | "BOTTOM" | "ACCESSORY";
  priceRange: "BUDGET" | "MID" | "PREMIUM";
  genderTarget?: string | null;
  subcategory?: string | null;
  tags: string[];
  bodyTypeFit: string[];
  imageUrl?: string | null;
  affiliateUrl?: string | null;
  weatherHot?: number | null;
  weatherCold?: number | null;
  weatherRain?: number | null;
  weatherWind?: number | null;
  createdAt?: SerializableDate;
  updatedAt?: SerializableDate;
  // The gear row's optimistic-concurrency counter, exactly as the server sent it. Validated before use (isUsableVersion): it may be missing or malformed.
  version?: number | null;
};

export type GenderTargetOption = "MEN" | "WOMEN" | "UNISEX";

export type EditableFields = {
  name: string;
  brandId: string;
  newBrandName: string;
  category: GearEditorItem["category"];
  priceRange: GearEditorItem["priceRange"];
  genderTarget: string;
  subcategory: string;
  imageUrl: string;
  affiliateUrl: string;
  tags: string;
  bodyTypeFit: string;
  weatherHot: string;
  weatherCold: string;
  weatherRain: string;
  weatherWind: string;
};

export const categoryOptions: Array<GearEditorItem["category"]> = ["TOP", "BOTTOM", "ACCESSORY"];
export const priceRangeOptions: Array<GearEditorItem["priceRange"]> = ["BUDGET", "MID", "PREMIUM"];
export const genderTargetOptions: Array<{ value: GenderTargetOption; label: string }> = [
  { value: "MEN", label: "Men" },
  { value: "WOMEN", label: "Women" },
  { value: "UNISEX", label: "Unisex" },
];
export const allowedGenderTargets = new Set(genderTargetOptions.map((option) => option.value));
export const weatherFields = [
  { key: "weatherHot", label: "Hot weather" },
  { key: "weatherCold", label: "Cold weather" },
  { key: "weatherRain", label: "Rain" },
  { key: "weatherWind", label: "Wind" },
] as const;

export function hasValue(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidHttpUrl(value: string) {
  if (!value.trim()) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinList(value?: string[] | null) {
  return value?.length ? value.join(", ") : "";
}

export function normalizeGenderTarget(value?: string | null) {
  const normalized = value?.trim().toUpperCase();
  return normalized && allowedGenderTargets.has(normalized as GenderTargetOption) ? normalized : "";
}

export function formatDate(value?: SerializableDate) {
  const date = toDate(value);
  if (!date) return "Pending";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function toFields(item?: GearEditorItem | null): EditableFields {
  return {
    name: item?.name ?? "",
    brandId: item?.brandId ?? "",
    newBrandName: "",
    category: item?.category ?? "TOP",
    priceRange: item?.priceRange ?? "MID",
    genderTarget: normalizeGenderTarget(item?.genderTarget),
    subcategory: item?.subcategory ?? "",
    imageUrl: item?.imageUrl ?? "",
    affiliateUrl: item?.affiliateUrl ?? "",
    tags: joinList(item?.tags),
    bodyTypeFit: joinList(item?.bodyTypeFit),
    weatherHot: item?.weatherHot?.toString() ?? "",
    weatherCold: item?.weatherCold?.toString() ?? "",
    weatherRain: item?.weatherRain?.toString() ?? "",
    weatherWind: item?.weatherWind?.toString() ?? "",
  };
}

export function parseWeatherScore(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Concurrency token
// ---------------------------------------------------------------------------------------------------------------------------------

/** `gear_items.version` is a 32-bit signed INTEGER; the server accepts exactly 0..2147483647 as expectedVersion. */
export const MAX_GEAR_VERSION = 2_147_483_647;

/** True only for a usable concurrency token: an integer number in the range the server accepts. Strings, null, floats, NaN and out-of-range values are not. */
export function isUsableVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_GEAR_VERSION;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Draft helpers
// ---------------------------------------------------------------------------------------------------------------------------------

const FIELD_KEYS = ["name", "brandId", "newBrandName", "category", "priceRange", "genderTarget", "subcategory", "imageUrl", "affiliateUrl", "tags", "bodyTypeFit", "weatherHot", "weatherCold", "weatherRain", "weatherWind"] as const satisfies ReadonlyArray<keyof EditableFields>;

/** Field-by-field equality of two drafts. */
export function fieldsEqual(a: EditableFields, b: EditableFields): boolean {
  return FIELD_KEYS.every((key) => a[key] === b[key]);
}

/** The existing local validation, with its exact messages, in its exact order. Returns null when the draft may be sent. */
export function validateFields(fields: EditableFields): string | null {
  const imageUrl = fields.imageUrl.trim();
  const affiliateUrl = fields.affiliateUrl.trim();
  if (hasValue(imageUrl) && !isValidHttpUrl(imageUrl)) return "Image URL must be a valid http or https URL.";
  if (hasValue(affiliateUrl) && !isValidHttpUrl(affiliateUrl)) return "Affiliate URL must be blank or a valid http or https URL.";
  if (!fields.name.trim() || !fields.brandId.trim() || !fields.category || !fields.priceRange) return "Name, brand ID, category, and price range are required.";
  if (fields.genderTarget && !allowedGenderTargets.has(fields.genderTarget as GenderTargetOption)) return "Gender must be Men, Women, or Unisex";
  return null;
}

/**
 * The request body for create and edit, exactly as the editor has always built it. It never contains `expectedVersion`: the token is a
 * condition on the request, added by the request layer, and is not an editable gear field. (`weatherSuitability.hot: null` keeps its
 * existing server-side meaning; that is untouched here.)
 */
export function buildGearPayload(fields: EditableFields) {
  return {
    name: fields.name,
    brandId: fields.brandId.trim(),
    category: fields.category,
    priceRange: fields.priceRange,
    genderTarget: fields.genderTarget.trim() || null,
    subcategory: fields.subcategory.trim() || null,
    tags: splitList(fields.tags),
    bodyTypeFit: splitList(fields.bodyTypeFit),
    imageUrl: fields.imageUrl.trim() || null,
    affiliateUrl: fields.affiliateUrl.trim() || null,
    weatherSuitability: {
      hot: parseWeatherScore(fields.weatherHot),
      cold: parseWeatherScore(fields.weatherCold),
      rain: parseWeatherScore(fields.weatherRain),
      wind: parseWeatherScore(fields.weatherWind),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Catalog synchronization
// ---------------------------------------------------------------------------------------------------------------------------------

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const isNullableNumber = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value));
const isDateLike = (value: unknown): value is string | Date => typeof value === "string" || value instanceof Date;
const isCategory = (value: unknown): value is GearEditorItem["category"] => value === "TOP" || value === "BOTTOM" || value === "ACCESSORY";
const isPriceRange = (value: unknown): value is GearEditorItem["priceRange"] => value === "BUDGET" || value === "MID" || value === "PREMIUM";

/**
 * Merges a saved item (a PATCH response: scalar columns only) into the catalog entry with the SAME id. Matching is by id and nothing
 * else: a different id returns the entry unchanged. Each column is applied only when it has the expected type, so a malformed response can
 * not corrupt the entry. `brand`, `variants` and any other relation of the entry are preserved, because the response does not carry them;
 * only if the brand id changed is the brand name refreshed from the known brand list (or cleared when it is unknown), since the old brand
 * would then be wrong. A saved response whose version is not newer than the entry's is ignored. The input is never modified.
 */
export function mergeSavedGearItem(entry: GearEditorItem, saved: Record<string, unknown>, brands: ReadonlyArray<{ id: string; name: string }> = []): GearEditorItem {
  if (saved.id !== entry.id) return entry;
  // Monotonic: a response that is not NEWER than what the catalog already holds (a late, duplicated or out-of-order response) changes nothing.
  if (isUsableVersion(saved.version) && isUsableVersion(entry.version) && saved.version <= entry.version) return entry;
  const merged: GearEditorItem = {
    ...entry,
    ...(typeof saved.name === "string" ? { name: saved.name } : {}),
    ...(typeof saved.brandId === "string" ? { brandId: saved.brandId } : {}),
    ...(isCategory(saved.category) ? { category: saved.category } : {}),
    ...(isPriceRange(saved.priceRange) ? { priceRange: saved.priceRange } : {}),
    ...(isNullableString(saved.genderTarget) ? { genderTarget: saved.genderTarget } : {}),
    ...(isNullableString(saved.subcategory) ? { subcategory: saved.subcategory } : {}),
    ...(isStringList(saved.tags) ? { tags: saved.tags } : {}),
    ...(isStringList(saved.bodyTypeFit) ? { bodyTypeFit: saved.bodyTypeFit } : {}),
    ...(isNullableString(saved.imageUrl) ? { imageUrl: saved.imageUrl } : {}),
    ...(isNullableString(saved.affiliateUrl) ? { affiliateUrl: saved.affiliateUrl } : {}),
    ...(isNullableNumber(saved.weatherHot) ? { weatherHot: saved.weatherHot } : {}),
    ...(isNullableNumber(saved.weatherCold) ? { weatherCold: saved.weatherCold } : {}),
    ...(isNullableNumber(saved.weatherRain) ? { weatherRain: saved.weatherRain } : {}),
    ...(isNullableNumber(saved.weatherWind) ? { weatherWind: saved.weatherWind } : {}),
    ...(isDateLike(saved.createdAt) ? { createdAt: saved.createdAt } : {}),
    ...(isDateLike(saved.updatedAt) ? { updatedAt: saved.updatedAt } : {}),
    ...(isUsableVersion(saved.version) ? { version: saved.version } : {}),
  };
  if (merged.brandId !== entry.brandId) {
    const brand = brands.find((candidate) => candidate.id === merged.brandId);
    merged.brand = brand ? { name: brand.name } : null;
  }
  return merged;
}

/**
 * The catalog the table and editor see: the server items, with a locally merged copy used ONLY while it is newer (a higher version) than
 * the server item. Once a refresh brings the same or a newer version, the server item wins, so a local copy can never mask fresher data.
 */
export function applyOverrides(items: readonly GearEditorItem[], overrides: ReadonlyMap<string, GearEditorItem>): GearEditorItem[] {
  return items.map((item) => {
    const override = overrides.get(item.id);
    if (!override) return item;
    if (!isUsableVersion(override.version)) return item;
    return !isUsableVersion(item.version) || override.version > item.version ? override : item;
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Parsing a server item
// ---------------------------------------------------------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const optionalNullableString = (value: unknown): value is string | null | undefined => value === undefined || isNullableString(value);
const optionalNullableNumber = (value: unknown): value is number | null | undefined => value === undefined || isNullableNumber(value);

/**
 * Validates one gear item from GET /api/admin/gear and returns it as a GearEditorItem, or null when it can not be used safely: a missing
 * or non-string id, name or brand id, an unknown category or price range, a non-list tags/bodyTypeFit, a mistyped optional column, or an
 * unusable version. Relations other than the brand NAME (variants, the rest of the brand row) are not part of the editor's item.
 */
export function parseGearItem(value: unknown): GearEditorItem | null {
  if (!isRecord(value)) return null;
  const { id, name, brandId, category, priceRange, tags, bodyTypeFit, version } = value;
  if (typeof id !== "string" || id === "" || typeof name !== "string" || typeof brandId !== "string") return null;
  if (!isCategory(category) || !isPriceRange(priceRange) || !isStringList(tags) || !isStringList(bodyTypeFit) || !isUsableVersion(version)) return null;
  const { genderTarget, subcategory, imageUrl, affiliateUrl, weatherHot, weatherCold, weatherRain, weatherWind, createdAt, updatedAt, brand } = value;
  if (!optionalNullableString(genderTarget) || !optionalNullableString(subcategory) || !optionalNullableString(imageUrl) || !optionalNullableString(affiliateUrl)) return null;
  if (!optionalNullableNumber(weatherHot) || !optionalNullableNumber(weatherCold) || !optionalNullableNumber(weatherRain) || !optionalNullableNumber(weatherWind)) return null;
  if (createdAt !== undefined && createdAt !== null && !isDateLike(createdAt)) return null;
  if (updatedAt !== undefined && updatedAt !== null && !isDateLike(updatedAt)) return null;
  const brandName = isRecord(brand) && isNullableString(brand.name) ? { name: brand.name } : brand === null ? null : undefined;
  return {
    id, name, brandId, category, priceRange, tags, bodyTypeFit, version,
    ...(genderTarget !== undefined ? { genderTarget } : {}), ...(subcategory !== undefined ? { subcategory } : {}),
    ...(imageUrl !== undefined ? { imageUrl } : {}), ...(affiliateUrl !== undefined ? { affiliateUrl } : {}),
    ...(weatherHot !== undefined ? { weatherHot } : {}), ...(weatherCold !== undefined ? { weatherCold } : {}),
    ...(weatherRain !== undefined ? { weatherRain } : {}), ...(weatherWind !== undefined ? { weatherWind } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(brandName !== undefined ? { brand: brandName } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Leaving the editor
// ---------------------------------------------------------------------------------------------------------------------------------

export const DISCARD_ON_SWITCH_MESSAGE = "You have unsaved changes. Discard them and switch?";

/**
 * Whether the catalog may switch away from the open editor. A clean editor may always be left, silently. A dirty one needs an explicit yes;
 * a "no" means the switch must not happen, so the selection and the draft stay exactly as they were.
 */
export function mayLeaveEditor(dirty: boolean, confirm: (message: string) => boolean): boolean {
  return !dirty || confirm(DISCARD_ON_SWITCH_MESSAGE);
}

/** Whether a freshly read server copy may replace the catalog's current one: never when it is OLDER (a late response from an earlier request). */
export function shouldAdoptLatest(current: GearEditorItem | undefined, latest: GearEditorItem): boolean {
  if (!current || !isUsableVersion(current.version) || !isUsableVersion(latest.version)) return true;
  return latest.version >= current.version;
}

type SwitchContext = { dirty: boolean; confirm: (message: string) => boolean };

/**
 * What the catalog does when an item is clicked. Re-selecting the item that is already open is not a switch ("ignore"). Otherwise a dirty
 * editor needs an explicit yes ("blocked" keeps the selection and the draft exactly as they were). In create mode the new-item form is the
 * open editor, so any existing item is a switch.
 */
export function decideSelect(targetId: string, context: SwitchContext & { isCreating: boolean; selectedId: string | null }): "ignore" | "blocked" | "switch" {
  if (!context.isCreating && targetId === context.selectedId) return "ignore";
  return mayLeaveEditor(context.dirty, context.confirm) ? "switch" : "blocked";
}

/** What the catalog does when "Add gear" is used: the same rule, so unsaved edits are never discarded silently. */
export function decideAddGear(context: SwitchContext): "blocked" | "switch" {
  return mayLeaveEditor(context.dirty, context.confirm) ? "switch" : "blocked";
}

/**
 * The item the editor shows: the selected one, found among ALL catalog items (so a search or filter that hides it never changes the
 * selection). Only if that id is no longer in the catalog at all (the item was deleted and the list refreshed) does the catalog fall back
 * to the first visible item. Create mode shows no existing item.
 */
export function resolveSelectedItem({ isCreating, selectedItemId, catalogItems, filteredItems }: { isCreating: boolean; selectedItemId: string | null; catalogItems: readonly GearEditorItem[]; filteredItems: readonly GearEditorItem[] }): GearEditorItem | null {
  if (isCreating) return null;
  return catalogItems.find((item) => item.id === selectedItemId) ?? filteredItems[0] ?? catalogItems[0] ?? null;
}
