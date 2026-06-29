// services/gearService.ts
import {
    createGearItem as createGearItemRecord,
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

function normalizeGearWriteInput(input: GearWriteInput): GearWriteInput & { slug: string } {
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

    const normalized = normalizeGearWriteInput({
        ...target,
        ...data,
        id,
        name: data.name ?? target.name,
        brandId: data.brandId ?? target.brandId,
        category: data.category ?? target.category,
        priceRange: data.priceRange ?? target.priceRange,
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
        variants: normalized.variants,
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
        return {
            action: "inserted" as const,
            item: await createGearItem(normalized),
        };
    }

    return {
        action: "updated" as const,
        item: await updateGearItem(matched.id, normalized),
    }
}

export async function bulkUpsertGearItems(items: GearWriteInput[]) {
    const deduped = new Map<string, GearWriteInput>();

    for (const item of items) {
        const normalized = normalizeGearWriteInput(item);
        const dedupeKey = normalized.externalId || normalized.slug;
        deduped.set(dedupeKey, normalized);
    }

    let inserted = 0;
    let updated = 0;
    const failed: Array<{ name: string; reason: string }> = [];

    for (const item of deduped.values()) {
        try {
            const result = await upsertGearItem(item);
            if (result.action === "inserted") inserted += 1;
            if (result.action === "updated") updated += 1;
        } catch (error) {
            failed.push({
                name: item.name,
                reason: error instanceof Error ? error.message : "Unknown error",
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