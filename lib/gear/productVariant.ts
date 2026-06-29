import { GenderPreference, ProductVariant, RecommendationGearItem } from "../engine/types/recommendationEngine";

type ProductVariantSource = Pick<RecommendationGearItem, "affiliateUrl" | "genderTarget" | "imageUrl" | "variants">;

type ProfileLike = { genderPreference?: GenderPreference | string | null } | null | undefined;

export function normalizeProductVariantGender(gender?: string | null): ProductVariant["gender"] | undefined {
    const normalized = gender?.trim().toLowerCase();
    if (normalized === "male" || normalized === "man" || normalized === "men") return "men";
    if (normalized === "female" || normalized === "woman" || normalized === "women") return "women";
    if (normalized === "unisex" || normalized === "non_binary" || normalized === "prefer_not_to_say") return "unisex";
    return undefined;
}

export function fallbackProductVariant(item: ProductVariantSource): ProductVariant | null {
    if (!item.affiliateUrl && !item.imageUrl) return null;

    return {
        label: "Default",
        gender: normalizeProductVariantGender(item.genderTarget) ?? "unisex",
        affiliateUrl: item.affiliateUrl ?? "",
        imageUrl: item.imageUrl ?? undefined,
    };
}

export function selectProductVariant(item: ProductVariantSource, profile?: ProfileLike): ProductVariant | null {
    const variants = item.variants?.length ? item.variants : [fallbackProductVariant(item)].filter((variant): variant is ProductVariant => Boolean(variant));
    const preferredGender = normalizeProductVariantGender(profile?.genderPreference);

    return (
        variants.find((variant) => preferredGender && variant.gender === preferredGender) ??
        variants.find((variant) => variant.gender === "unisex") ??
        variants[0] ??
        null
    );
}