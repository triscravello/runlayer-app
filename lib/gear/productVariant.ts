import { GenderPreference, ProductVariant, RecommendationGearItem } from "../engine/types/recommendationEngine";
import { isSafeHttpUrl } from "./externalUrl";

type ProductVariantSource = Pick<RecommendationGearItem, "affiliateUrl" | "genderTarget" | "imageUrl" | "variants">;

type ProfileLike = { genderPreference?: GenderPreference | string | null } | null | undefined;

export function normalizeProductVariantGender(gender?: string | null): ProductVariant["gender"] | undefined {
    const normalized = gender?.trim().toLowerCase();
    if (normalized === "male" || normalized === "man" || normalized === "men") return "men";
    if (normalized === "female" || normalized === "woman" || normalized === "women") return "women";
    if (normalized === "unisex" || normalized === "non_binary" || normalized === "prefer_not_to_say") return "unisex";
    return undefined;
}

/**
 * Read-time containment for a stored link. A value that is not a safe http(s) URL becomes null; an absent value (null,
 * undefined or "") is returned exactly as stored, so the shape of "no link" does not change. The stored row is never touched.
 */
export function containAffiliateUrl<T extends string | null | undefined>(value: T): T | null {
    if (value === null || value === undefined || value === "") return value;
    return isSafeHttpUrl(value) ? value : null;
}

/** The same variant with an unsafe link removed; the original object is returned untouched when nothing changes. */
export function containVariantLink<T extends { affiliateUrl?: string | null }>(variant: T): T {
    if (variant.affiliateUrl === undefined) return variant;
    const contained = containAffiliateUrl(variant.affiliateUrl);
    return contained === variant.affiliateUrl ? variant : { ...variant, affiliateUrl: contained };
}

/** An item or catalog row with unsafe affiliate links removed (its own and each variant's). Other fields, including imageUrl, are untouched. */
export function containGearItemLinks<T extends { affiliateUrl?: string | null; variants?: Array<{ affiliateUrl?: string | null }> | null }>(item: T): T {
    const contained: T = { ...item };
    if (item.affiliateUrl !== undefined) contained.affiliateUrl = containAffiliateUrl(item.affiliateUrl);
    if (Array.isArray(item.variants)) contained.variants = item.variants.map(containVariantLink) as T["variants"];
    return contained;
}

export function fallbackProductVariant(item: ProductVariantSource): ProductVariant | null {
    // Whether a fallback exists is decided on the stored values, so selection behavior is unchanged by containment.
    if (!item.affiliateUrl && !item.imageUrl) return null;

    return {
        label: "Default",
        gender: normalizeProductVariantGender(item.genderTarget) ?? "unisex",
        affiliateUrl: containAffiliateUrl(item.affiliateUrl) ?? "",
        imageUrl: item.imageUrl ?? undefined,
    };
}

export function selectProductVariant(item: ProductVariantSource, profile?: ProfileLike): ProductVariant | null {
    const variants = item.variants?.length ? item.variants.map(containVariantLink) : [fallbackProductVariant(item)].filter((variant): variant is ProductVariant => Boolean(variant));
    const preferredGender = normalizeProductVariantGender(profile?.genderPreference);

    return (
        variants.find((variant) => preferredGender && variant.gender === preferredGender) ??
        variants.find((variant) => variant.gender === "unisex") ??
        variants[0] ??
        null
    );
}