import { toPublicGearItem } from "./publicGear";

// Client-facing serialization of gear objects that are NESTED inside other API responses (saved outfits, recommendation history).
// It reuses the public catalog's explicit allow-list (toPublicGearItem): every column that was already returned stays, with the same
// values, and anything else (the internal `version` counter and any column added to the model later) is dropped at the item, brand and
// variant level. Unsafe affiliate links are contained, as everywhere a gear link leaves the server. Parent envelopes are not
// reshaped: only the `gearItem` object of each entry is rebuilt; every other key, its order and its nullability are untouched.
// Inputs are never modified (shallow copies are made along the path).

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------------------------------------------------------------
// Types. The RUNTIME behavior is the allow-list in publicGear.ts; these types describe its result so callers keep exact types for
// everything that is preserved and get a COMPILE ERROR for anything that is dropped (notably `version`). The key lists below mirror
// publicGear.ts's allow-lists; a test fails if they ever drift apart.
// ---------------------------------------------------------------------------------------------------------------------------------
export const CLIENT_GEAR_ITEM_KEYS = ["id", "name", "brandId", "genderTarget", "category", "subcategory", "priceRange", "tags", "weatherHot", "weatherCold", "weatherRain", "weatherWind", "bodyTypeFit", "imageUrl", "affiliateUrl", "createdAt", "updatedAt"] as const;
export const CLIENT_GEAR_BRAND_KEYS = ["id", "name", "normalizedName", "tier", "style", "createdAt", "updatedAt"] as const;
export const CLIENT_GEAR_VARIANT_KEYS = ["id", "gearItemId", "label", "gender", "affiliateUrl", "imageUrl", "price", "sizes", "createdAt", "updatedAt"] as const;

type ItemKey = (typeof CLIENT_GEAR_ITEM_KEYS)[number];
type BrandKey = (typeof CLIENT_GEAR_BRAND_KEYS)[number];
type VariantKey = (typeof CLIENT_GEAR_VARIANT_KEYS)[number];

// An allow-listed field is optional in the result: a value that is `undefined` is omitted, never serialized.
type Allowed<T, K extends string> = { [P in Extract<keyof T, K>]?: T[P] };
type BrandPart<G> = G extends { brand: infer B } ? { brand?: B extends object ? Allowed<B, BrandKey> : B } : unknown;
type VariantsPart<G> = G extends { variants: infer V } ? { variants?: V extends ReadonlyArray<infer E> ? Array<Allowed<E, VariantKey>> : V } : unknown;

/** A gear object as the client receives it: only the allow-listed fields of the item, its brand and its variants. */
export type ClientGearObject<G> = Allowed<G, ItemKey> & BrandPart<G> & VariantsPart<G>;
type ClientEntry<E> = E extends { gearItem: infer G } ? Omit<E, "gearItem"> & { gearItem: G extends object ? ClientGearObject<G> : G } : E;
type ClientList<L> = L extends ReadonlyArray<infer E> ? Array<ClientEntry<E>> : L;

export type ClientSavedOutfit<O> = O extends { OutfitItem: infer L } ? Omit<O, "OutfitItem"> & { OutfitItem: ClientList<L> } : O;
export type ClientRecommendationRecord<R> = R extends { items: infer L } ? Omit<R, "items"> & { items: ClientList<L> } : R;

// ---------------------------------------------------------------------------------------------------------------------------------
// Runtime (unchanged by the typing above).
// ---------------------------------------------------------------------------------------------------------------------------------

/** One entry of a nested list with its `gearItem` rebuilt. A null, missing or non-object `gearItem` is left exactly as it was. */
function withClientGear(entry: unknown): unknown {
    if (!isRow(entry)) return entry;
    const gear = entry.gearItem;
    return isRow(gear) ? { ...entry, gearItem: toPublicGearItem(gear) } : { ...entry };
}

const mapList = (list: unknown) => (Array.isArray(list) ? list.map(withClientGear) : list);

/** A saved outfit as the API returns it: the same row, with each OutfitItem's gearItem contained. */
export function toClientSavedOutfit<O extends object>(outfit: O): ClientSavedOutfit<O>;
export function toClientSavedOutfit(outfit: object): object {
    return { ...outfit, ...("OutfitItem" in outfit && outfit.OutfitItem !== undefined ? { OutfitItem: mapList(outfit.OutfitItem) } : {}) };
}

/** A recommendation-history record as the API returns it: the same row, with each item's gearItem contained. */
export function toClientRecommendationRecord<R extends object>(record: R): ClientRecommendationRecord<R>;
export function toClientRecommendationRecord(record: object): object {
    return { ...record, ...("items" in record && record.items !== undefined ? { items: mapList(record.items) } : {}) };
}
