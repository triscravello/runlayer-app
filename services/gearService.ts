// services/gearService.ts
import { InvalidGearInputError, isPlainObject } from "@/lib/gear/inputErrors";
import { createWithRaceRecovery, safeWriteFailureReason } from "@/lib/ingestion/writeRecovery";
import {
    createGearItem as createGearItemRecord,
    findGearItemByNameAndBrand,
    listGearItems,
    updateGearItem as updateGearItemRecord,
    type GearItemRow,
} from "@/lib/db/gearRepository";

export type GearFilters = {
    brandId?: string;
    category?: GearItemRow["category"];
    priceRange?: GearItemRow["priceRange"];
    tags?: string[];
};

export type GearProductVariantInput = { label: string; gender: string; affiliateUrl?: string | null; imageUrl?: string | null; price?: number | null; sizes?: string[]; };

export type GearWriteInput = {
    id?: string;
    externalId?: string;
    name: string;
    brandId: string;
    category: GearItemRow["category"];
    priceRange: GearItemRow["priceRange"];
    genderTarget?: string | null;
    subcategory?: string | null;
    tags?: string[];
    bodyTypeFit?: string[];
    imageUrl?: string | null;
    affiliateUrl: string | null;
    variants?: GearProductVariantInput[];
    weatherSuitability?: Partial<Record<"hot" | "cold" | "rain" | "wind", number | null>>;
};

function slugify(value: string): string {
    return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function normalizeTags(tags: string[] | undefined): string[] {
    if (!tags) {
        return [];
    }

    return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Refuses malformed `tags` and `variants` before anything is normalized. Without this, a non-array `variants` (null, {}, a
 * string) quietly became a synthesized Default variant that replaced the stored ones, and `tags: null` quietly cleared tags.
 * `undefined` means "not supplied" and is fine; `[]` is a valid, intentional empty list. Field-level checks of each variant
 * happen in the repository's shared variant mapper. Messages contain no submitted values.
 */
function assertWriteShape(input: unknown): asserts input is GearWriteInput {
    if (!isPlainObject(input)) throw new InvalidGearInputError("Invalid gear input: payload must be an object");

    const { tags, variants } = input;
    if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string"))) {
        throw new InvalidGearInputError("Invalid gear input: tags must be an array of strings");
    }
    if (variants !== undefined) {
        if (!Array.isArray(variants)) throw new InvalidGearInputError("Invalid gear input: variants must be an array");
        if (variants.some((variant) => !isPlainObject(variant))) throw new InvalidGearInputError("Invalid gear input: each variant must be an object");
    }
}

function normalizeGearWriteInput(input: GearWriteInput): GearWriteInput & { slug: string } {
    assertWriteShape(input);
    const cleanName = input.name.trim();
    const slug = slugify(`${cleanName}-${input.brandId}`);

    return {
        ...input,
        name: cleanName,
        subcategory: input.subcategory?.trim() || null,
        genderTarget: input?.genderTarget?.trim() || null,
        tags: normalizeTags(input.tags),
        variants: input.variants?.length ? input.variants : [{ label: "Default", gender: "unisex", affiliateUrl: input.affiliateUrl, imageUrl: input.imageUrl }],
        slug,
    };
}

function buildSlugForDbItem(item: GearItemRow): string {
    return slugify(`${item.name}-${item.brandId}`);
}

export async function getGear(filters: GearFilters = {}) {
    const items = await listGearItems();

    return items.filter((item) => {
        if (filters.brandId && item.brandId !== filters.brandId) {
            return false;
        }

        if (filters.category && item.category !== filters.category) {
            return false;
        }

        if (filters.priceRange && item.priceRange !== filters.priceRange) {
            return false;
        }

        if (filters.tags?.length) {
            const itemTags = new Set(item.tags.map((tag) => tag.toLowerCase()));
            return filters.tags.every((tag) => itemTags.has(tag.toLowerCase()));
        }

        return true;
    });
}

export async function createGearItem(data: GearWriteInput) {
    const normalized = normalizeGearWriteInput(data);

    return createGearItemRecord({
        name: normalized.name,
        brandId: normalized.brandId,
        category: normalized.category,
        priceRange: normalized.priceRange,
        genderTarget: normalized.genderTarget,
        subcategory: normalized.subcategory,
        tags: normalized.tags,
        bodyTypeFit: normalized.bodyTypeFit,
        imageUrl: normalized.imageUrl,
        affiliateUrl: normalized.affiliateUrl,
        variants: normalized.variants,
        weatherSuitability: normalized.weatherSuitability,
    });
}

export async function updateGearItem(id: string, data: Partial<GearWriteInput>) {
    const currentItems = await listGearItems();
    const target = currentItems.find((item) => item.id === id);

    if (!target) {
        throw new Error(`Gear item not found for id: ${id}`);
    }

    // An explicitly supplied `undefined` means "not supplied", exactly like an omitted key. Spreading it would overwrite the
    // stored value with undefined and silently clear tags, genderTarget or subcategory. `null` and `[]` still clear.
    const supplied = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<GearWriteInput>;

    const normalized = normalizeGearWriteInput({
        ...target,
        ...supplied,
        id,
        name: supplied.name ?? target.name,
        brandId: supplied.brandId ?? target.brandId,
        category: supplied.category ?? target.category,
        priceRange: supplied.priceRange ?? target.priceRange,
    });

    return updateGearItemRecord({
        id,
        name: normalized.name,
        brandId: normalized.brandId,
        category: normalized.category,
        priceRange: normalized.priceRange,
        genderTarget: normalized.genderTarget,
        subcategory: normalized.subcategory,
        tags: normalized.tags,
        bodyTypeFit: normalized.bodyTypeFit,
        imageUrl: normalized.imageUrl,
        affiliateUrl: normalized.affiliateUrl,
        // Only rewrite variants when the caller supplied them. Otherwise the stored rows (and their ids) are left alone;
        // `normalized.variants` would just be those same rows echoed back, or a synthesized Default.
        variants: supplied.variants !== undefined ? normalized.variants : undefined,
        weatherSuitability: normalized.weatherSuitability,
    });
}

export async function upsertGearItem(data: GearWriteInput) {
    const normalized = normalizeGearWriteInput(data);
    const allItems = await listGearItems();

    const matched = allItems.find((item) => {
        if (normalized.externalId && normalized.externalId === item.id) {
            return true;
        }

        return buildSlugForDbItem(item) === normalized.slug;
    });

    if (!matched) {
        // If a concurrent importer created the same (name, brand) between our lookup and this create, re-read the
        // current row and update it instead (once, and only for a verified conflict on that unique key).
        return createWithRaceRecovery({
            create: () => createGearItem(normalized),
            findExisting: () => findGearItemByNameAndBrand(normalized.name, normalized.brandId),
            update: (id) => updateGearItem(id, normalized),
        });
    }

    return {
        action: "updated" as const,
        item: await updateGearItem(matched.id, normalized),
    }
}

export async function bulkUpsertGearItems(items: GearWriteInput[]) {
    const deduped = new Map<string, GearWriteInput>();
    const failed: Array<{ name: string; reason: string }> = [];

    for (const item of items) {
        try {
            const normalized = normalizeGearWriteInput(item);
            const dedupeKey = normalized.externalId || normalized.slug;
            deduped.set(dedupeKey, normalized);
        } catch (error) {
            // One malformed item is reported and skipped; it must not abort the rest of the batch. Anything else still propagates.
            if (!(error instanceof InvalidGearInputError)) throw error;
            failed.push({ name: typeof item?.name === "string" ? item.name : "(invalid item)", reason: safeWriteFailureReason(error) });
        }
    }

    let inserted = 0;
    let updated = 0;

    for (const item of deduped.values()) {
        try {
            const result = await upsertGearItem(item);
            if (result.action === "inserted") inserted += 1;
            if (result.action === "updated") updated += 1;
        } catch (error) {
            failed.push({
                name: item.name,
                // Fixed, sanitized reason: raw error messages can contain query details.
                reason: safeWriteFailureReason(error),
            });
        } 
    }

    return {
        total: deduped.size,
        inserted,
        updated,
        failed,
    };
}