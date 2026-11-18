// services/gearService.ts
import { safeHttpUrl } from "@/lib/gear/externalUrl";
import { GearItemNotFoundError, InvalidGearInputError, isPlainObject } from "@/lib/gear/inputErrors";
import { createWithRaceRecovery, safeWriteFailureReason } from "@/lib/ingestion/writeRecovery";
import {
    createGearItem as createGearItemRecord,
    findGearItemByNameAndBrand,
    assertGearUpdateHasFields,
    findGearItemForUpdate,
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

type StoredLinks = { affiliateUrl: string | null; imageUrl: string | null };

/**
 * `variants: []` replaces the variants with one synthesized Default, whose links are copied from the item-level links: the
 * supplied ones, otherwise the stored ones. A stored link may predate link validation, so it is not copied into the new row
 * when unsafe and the edit still succeeds. An item link the caller supplied is copied as is, so an unsafe one is refused by the
 * repository. Explicitly supplied non-empty variants are never touched here; they are validated, not corrected.
 */
function variantsForUpdate(supplied: Partial<GearWriteInput>, stored: StoredLinks): GearProductVariantInput[] | undefined {
    const variants = supplied.variants;
    if (variants === undefined) return undefined;
    if (variants.length > 0) return variants;

    const affiliateUrl = supplied.affiliateUrl !== undefined ? supplied.affiliateUrl : stored.affiliateUrl;
    const imageUrl = supplied.imageUrl !== undefined ? supplied.imageUrl : stored.imageUrl;
    return [{ label: "Default", gender: "unisex", affiliateUrl: supplied.affiliateUrl !== undefined ? affiliateUrl : safeHttpUrl(affiliateUrl), imageUrl }];
}

// Same trim-or-null rule the full-record normalizer applies to these two optional text columns; non-strings are passed through
// so the repository's validation refuses them (never silently turned into null).
const trimOrNull = (value: unknown) => (typeof value === "string" ? value.trim() || null : value);

/**
 * Sparse update (PATCH semantics). Only fields present in `data` with a value other than `undefined` are written; an omitted key
 * and an explicit `undefined` both mean "leave the stored value alone", while `null` and `[]` are explicit clears. Nothing is
 * rebuilt from the stored row, so two concurrent updates of different fields can no longer overwrite each other with stale
 * copies. `variants` is written (whole-set replacement) only when supplied.
 *
 * Callers: the admin PATCH route passes exactly the fields the client sent. The importer (`upsertGearItem`) passes a complete,
 * normalized record, so every column it intentionally supplies, including defaults such as `genderTarget: null` or `tags: []`,
 * is still written, exactly as before.
 *
 * Known limitations, deliberately left for Stage 2 (optimistic concurrency / versioning; no locks, columns or migrations here):
 *  - Stale full-form editor. components/admin/gear/GearEditor.tsx PATCHes every field it loaded (name, brandId, category,
 *    priceRange, genderTarget, subcategory, tags, bodyTypeFit, imageUrl, affiliateUrl, weatherSuitability) on every save. Those
 *    are all "supplied", so a form opened before another admin's edit still overwrites that edit with its stale copy of every
 *    field it carries. Sparse writes protect only clients that send just what they changed.
 *  - A `variants: []` Default is synthesized from links read in the lookup, so a link changed in between can be copied stale.
 *  - Two writers of the SAME field remain last-write-wins.
 */
export async function updateGearItem(id: string, data: Partial<GearWriteInput>) {
    assertWriteShape(data);
    const supplied = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<GearWriteInput>;

    // Nothing recognized to write (e.g. only unknown keys): a controlled error before any read or write. The repository enforces the same rule.
    assertGearUpdateHasFields(supplied);

    const stored = await findGearItemForUpdate(id);
    if (!stored) throw new GearItemNotFoundError();

    const update: Parameters<typeof updateGearItemRecord>[0] = { id };
    if ("name" in supplied) update.name = typeof supplied.name === "string" ? supplied.name.trim() : supplied.name;
    if ("brandId" in supplied) update.brandId = supplied.brandId;
    if ("category" in supplied) update.category = supplied.category;
    if ("priceRange" in supplied) update.priceRange = supplied.priceRange;
    if ("genderTarget" in supplied) update.genderTarget = trimOrNull(supplied.genderTarget) as string | null;
    if ("subcategory" in supplied) update.subcategory = trimOrNull(supplied.subcategory) as string | null;
    if ("tags" in supplied) update.tags = normalizeTags(supplied.tags);
    if ("bodyTypeFit" in supplied) update.bodyTypeFit = supplied.bodyTypeFit;
    if ("imageUrl" in supplied) update.imageUrl = supplied.imageUrl;
    if ("affiliateUrl" in supplied) update.affiliateUrl = supplied.affiliateUrl;
    if ("variants" in supplied) update.variants = variantsForUpdate(supplied, stored);
    if ("weatherSuitability" in supplied) update.weatherSuitability = supplied.weatherSuitability;

    return updateGearItemRecord(update);
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