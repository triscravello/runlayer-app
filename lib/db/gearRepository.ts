import { Category, PriceRange, type Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { GearItem } from "../engine/recommendationEngine";
import { isSafeHttpUrl, safeHttpUrl } from "../gear/externalUrl";
import { assertExpectedVersion, GearItemNotFoundError, GearItemStaleVersionError, InvalidGearInputError, isPlainObject } from "../gear/inputErrors";
import { containAffiliateUrl, containVariantLink, normalizeProductVariantGender, selectProductVariant } from "../gear/productVariant";

export type GearItemRow = Awaited<ReturnType<typeof prisma.gearItem.findMany>>[number];

type GearVariantWriteInput = { label: string; gender: string; affiliateUrl?: string | null; imageUrl?: string | null; price?: number | null; sizes?: string[]; };

type CreateGearInput = {
    name: string;
    brandId: string;
    genderTarget?: string | null;
    category: GearItemRow["category"];
    subcategory?: string | null;
    priceRange: GearItemRow["priceRange"];
    tags?: string[];
    weatherSuitability?: Partial<Record<"hot" | "warm" | "cold" | "rain" | "wind", number | null>>;
    bodyTypeFit?: string[];
    imageUrl?: string | null;
    affiliateUrl?: string | null;
    variants?: GearVariantWriteInput[];
}

type UpdateGearInput = Partial<Omit<CreateGearInput, "weatherSuitability">> & {
    id: string;
    weatherSuitability?: CreateGearInput["weatherSuitability"];
};

export async function listGearItems() {
    return prisma.gearItem.findMany({
        include: {
            brand: true,
            variants: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });
}

// Re-reads the current row for the (name, brandId) unique key; used to verify a concurrent-create conflict.
export async function findGearItemByNameAndBrand(name: string, brandId: string) {
    return prisma.gearItem.findUnique({
        where: { name_brandId: { name, brandId } },
        select: { id: true },
    });
}

export async function createGearItem(input: CreateGearInput) {
    return prisma.gearItem.create({
        data: {
            name: input.name,
            brandId: input.brandId,
            genderTarget: input.genderTarget,
            category: input.category,
            subcategory: input.subcategory,
            priceRange: input.priceRange,
            tags: input.tags ?? [],
            weatherHot: input.weatherSuitability?.hot ?? input.weatherSuitability?.warm,
            weatherCold: input.weatherSuitability?.cold,
            weatherRain: input.weatherSuitability?.rain,
            weatherWind: input.weatherSuitability?.wind,
            bodyTypeFit: input.bodyTypeFit ?? [],
            imageUrl: input.imageUrl,
            affiliateUrl: input.affiliateUrl,
            variants: input.variants === undefined || (Array.isArray(input.variants) && input.variants.length === 0) ? undefined : { create: buildVariantCreateList(input.variants) },
        },
    });
}

/** What an update needs from the database client: an interactive transaction. */
export type GearWriter = Pick<PrismaClient, "$transaction">;

/** Raised when a write payload carries a field, relation operation, or value type the repository does not support. */
export class InvalidGearUpdateError extends InvalidGearInputError {
    constructor(reason: string) {
        super(`Invalid gear update: ${reason}`);
        this.name = "InvalidGearUpdateError";
    }
}

const CATEGORIES: ReadonlySet<string> = new Set(Object.values(Category));
const PRICE_RANGES: ReadonlySet<string> = new Set(Object.values(PriceRange));
const UPDATE_KEYS: ReadonlySet<string> = new Set(["id", "name", "brandId", "genderTarget", "category", "subcategory", "priceRange", "tags", "bodyTypeFit", "imageUrl", "affiliateUrl", "variants", "weatherSuitability"]);
const VARIANT_KEYS: ReadonlySet<string> = new Set(["label", "gender", "affiliateUrl", "imageUrl", "price", "sizes"]);
// Read-only columns of a stored variant row. gearService.updateGearItem falls back to the row it just read when the
// caller sends no variants, so these arrive echoed back; they are dropped (never written), unlike any other extra key.
const VARIANT_ECHOED_COLUMNS: ReadonlySet<string> = new Set(["id", "gearItemId", "createdAt", "updatedAt"]);
const WEATHER_KEYS: ReadonlySet<string> = new Set(["hot", "warm", "cold", "rain", "wind"]);

function assertKnownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, where: string) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new InvalidGearUpdateError(`unsupported field in ${where}`);
    }
}

function requireString(value: unknown, field: string, { nonEmpty = false } = {}): string {
    if (typeof value !== "string" || (nonEmpty && value.trim() === "")) throw new InvalidGearUpdateError(`${field} must be ${nonEmpty ? "a non-empty " : "a "}string`);
    return value;
}

function nullableString(value: unknown, field: string): string | null {
    return value === null ? null : requireString(value, field);
}

/**
 * A variant's affiliate link as it will be stored. `undefined` leaves the column unset, `null` and a blank string mean "no link"
 * (stored as null); anything else must pass the shared http(s) link policy or the write is refused. Nothing is sanitized.
 */
function variantAffiliateUrl(value: unknown, field: string): string | null | undefined {
    if (value === undefined || value === null) return value;
    const text = requireString(value, field);
    if (text.trim() === "") return null;
    if (!isSafeHttpUrl(text)) throw new InvalidGearUpdateError(`${field} must be an http(s) link`);
    return text;
}

function stringList(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new InvalidGearUpdateError(`${field} must be an array of strings`);
    return [...value];
}

function nullableFiniteNumber(value: unknown, field: string): number | null {
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidGearUpdateError(`${field} must be a finite number or null`);
    return value;
}

/** Field-by-field validated Prisma `create` data for one variant. Used for both create and update, so the rules are the same. */
export function buildVariantCreateData(value: unknown, index: number) {
    const field = `variants[${index}]`;
    if (!isPlainObject(value)) throw new InvalidGearUpdateError(`${field} must be an object`);
    assertKnownKeys(value, new Set([...VARIANT_KEYS, ...VARIANT_ECHOED_COLUMNS]), field);
    return {
        label: requireString(value.label, `${field}.label`, { nonEmpty: true }),
        gender: requireString(value.gender, `${field}.gender`, { nonEmpty: true }),
        affiliateUrl: variantAffiliateUrl(value.affiliateUrl, `${field}.affiliateUrl`),
        imageUrl: value.imageUrl === undefined ? undefined : nullableString(value.imageUrl, `${field}.imageUrl`),
        price: value.price === undefined ? undefined : nullableFiniteNumber(value.price, `${field}.price`),
        sizes: value.sizes === undefined ? [] : stringList(value.sizes, `${field}.sizes`),
    };
}

/** Validated `create` data for a list of variants. Anything that is not an array of plain variant objects is refused. */
export function buildVariantCreateList(variants: unknown) {
    if (!Array.isArray(variants)) throw new InvalidGearUpdateError("variants must be an array");
    return variants.map(buildVariantCreateData);
}

/**
 * Builds the Prisma `data` for a gear update from an explicit allowlist. Nothing from `input` is spread: every field is
 * validated and copied by name, so relation operations (`brand`, `OutfitItem`, `RecommendationItem`, nested `variants`
 * operators) and protected columns (`id`, `createdAt`, `updatedAt`, the `weather*` columns) can never be injected.
 * `undefined` leaves a column unchanged; `null` clears a nullable one. Throws InvalidGearUpdateError on anything else.
 */
export function buildGearUpdateData(input: unknown): { id: string; data: Prisma.GearItemUpdateInput | Prisma.GearItemUncheckedUpdateInput } {
    if (!isPlainObject(input)) throw new InvalidGearUpdateError("payload must be an object");
    assertKnownKeys(input, UPDATE_KEYS, "payload");

    const id = requireString(input.id, "id", { nonEmpty: true });
    const data: Prisma.GearItemUncheckedUpdateInput = {};

    if (input.name !== undefined) data.name = requireString(input.name, "name", { nonEmpty: true });
    if (input.brandId !== undefined) data.brandId = requireString(input.brandId, "brandId", { nonEmpty: true });
    if (input.genderTarget !== undefined) data.genderTarget = nullableString(input.genderTarget, "genderTarget");
    if (input.subcategory !== undefined) data.subcategory = nullableString(input.subcategory, "subcategory");
    if (input.imageUrl !== undefined) data.imageUrl = nullableString(input.imageUrl, "imageUrl");
    if (input.affiliateUrl !== undefined) data.affiliateUrl = nullableString(input.affiliateUrl, "affiliateUrl");
    if (input.tags !== undefined) data.tags = stringList(input.tags, "tags");
    if (input.bodyTypeFit !== undefined) data.bodyTypeFit = stringList(input.bodyTypeFit, "bodyTypeFit");

    if (input.category !== undefined) {
        if (typeof input.category !== "string" || !CATEGORIES.has(input.category)) throw new InvalidGearUpdateError("category is not a supported value");
        data.category = input.category as Category;
    }
    if (input.priceRange !== undefined) {
        if (typeof input.priceRange !== "string" || !PRICE_RANGES.has(input.priceRange)) throw new InvalidGearUpdateError("priceRange is not a supported value");
        data.priceRange = input.priceRange as PriceRange;
    }

    if (input.variants !== undefined) {
        // The only nested operations ever emitted are these two fixed ones, never caller-supplied operators.
        data.variants = { deleteMany: {}, create: buildVariantCreateList(input.variants) };
    }

    if (input.weatherSuitability !== undefined) {
        const weather = input.weatherSuitability;
        if (!isPlainObject(weather)) throw new InvalidGearUpdateError("weatherSuitability must be an object");
        assertKnownKeys(weather, WEATHER_KEYS, "weatherSuitability");
        const score = (key: string) => (weather[key] === undefined ? undefined : nullableFiniteNumber(weather[key], `weatherSuitability.${key}`));
        // `warm` is the legacy alias of `hot`; preserved from the previous mapping.
        data.weatherHot = score("hot") ?? score("warm");
        data.weatherCold = score("cold");
        data.weatherRain = score("rain");
        data.weatherWind = score("wind");
    }

    return { id, data };
}

/**
 * Refuses an update that carries nothing to write, so it can never become an empty Prisma update (which would still bump
 * `updatedAt`). "Something to write" mirrors the HTTP schema's rule: any field other than `id` with a value other than
 * `undefined`, or at least one weather score that is not `undefined` (an explicit `null` counts: it is a supplied value, and
 * `hot: null` keeps its existing no-op meaning). Non-objects are left to buildGearUpdateData to report.
 */
export function assertGearUpdateHasFields(input: unknown): void {
    if (!isPlainObject(input)) return;
    const weather = input.weatherSuitability;
    const hasField = [...UPDATE_KEYS].some((key) => key !== "id" && key !== "weatherSuitability" && input[key] !== undefined);
    const hasScore = isPlainObject(weather) && Object.values(weather).some((score) => score !== undefined);
    if (!hasField && !hasScore) throw new InvalidGearUpdateError("no fields to update");
}

export type GearUpdateOptions = {
    /**
     * Concurrency token. When supplied, the update applies only if the stored `version` still equals it (otherwise
     * GearItemStaleVersionError). When `undefined` the update is unconditional (last write wins), as for importers.
     * Every successful update, conditional or not, increments `version`. It is an option, never part of the item payload:
     * a client can not write `version` directly.
     */
    expectedVersion?: number;
};

/**
 * Updates one gear item in a single interactive transaction.
 *
 *  1. One conditional UPDATE of the parent row (`WHERE id [AND version = expected]`) setting only the supplied scalar columns plus
 *     `version = version + 1`. It takes the row lock, which is held until commit, so a second writer waits and then re-evaluates its
 *     own WHERE against the committed row. Variant-only edits still write the parent, so they always advance `version`.
 *  2. count 0: the item is missing (typed not-found) or, for a conditional update only, changed since it was read (typed stale).
 *  3. Variant writes (replace the whole set) happen inside the same transaction, after the lock is held. `variants: []` is a
 *     Default variant built from the item's links as read NOW, under the lock: the supplied link if the request carried one,
 *     otherwise the stored link, which is dropped when it is not a safe link. Nothing is derived from an earlier unlocked read.
 *  4. The updated row (with its new `version`) is read and returned from inside the transaction.
 * Any throw rolls everything back. All validation runs before the transaction opens, so invalid input costs no database access.
 * A transaction timeout is not caught here and is never reported as a stale version.
 *
 * The row lock and READ COMMITTED re-evaluation are PostgreSQL behavior that unit-test fakes only model; see the Stage 2B proof plan.
 */
export async function updateGearItem(input: UpdateGearInput, options: GearUpdateOptions = {}, client: GearWriter = prisma) {
    const { expectedVersion } = options;
    assertExpectedVersion(expectedVersion);

    const { id, data } = buildGearUpdateData(input);
    assertGearUpdateHasFields(input);

    const { variants: _nestedVariants, ...scalarData } = data as Prisma.GearItemUncheckedUpdateInput;
    void _nestedVariants;
    const variantsSupplied = input.variants !== undefined;
    const synthesizeDefault = variantsSupplied && Array.isArray(input.variants) && input.variants.length === 0;
    const suppliedRows = variantsSupplied && !synthesizeDefault ? buildVariantCreateList(input.variants) : undefined;
    // A link supplied together with `variants: []` is copied into the Default as is, so it must pass the link policy now, before any write.
    if (synthesizeDefault && input.affiliateUrl !== undefined) buildVariantCreateData({ label: "Default", gender: "unisex", affiliateUrl: input.affiliateUrl, imageUrl: null }, 0);

    return client.$transaction(async (tx) => {
        const where: Prisma.GearItemWhereInput = expectedVersion === undefined ? { id } : { id, version: expectedVersion };
        const result = await tx.gearItem.updateMany({
            where,
            data: { ...(scalarData as Prisma.GearItemUncheckedUpdateManyInput), updatedAt: new Date(), version: { increment: 1 } },
        });

        if (result.count === 0) {
            // An unconditional update can only fail because the item is gone. A conditional one is stale unless the item is gone.
            if (expectedVersion === undefined) throw new GearItemNotFoundError();
            const current = await tx.gearItem.findUnique({ where: { id }, select: { id: true } });
            throw current ? new GearItemStaleVersionError() : new GearItemNotFoundError();
        }
        if (result.count !== 1) throw new Error("Unexpected gear item update count");

        if (variantsSupplied) {
            let rows = suppliedRows;
            if (synthesizeDefault) {
                const links = await tx.gearItem.findUnique({ where: { id }, select: { affiliateUrl: true, imageUrl: true } });
                if (!links) throw new GearItemNotFoundError();
                const affiliateUrl = input.affiliateUrl !== undefined ? links.affiliateUrl : safeHttpUrl(links.affiliateUrl);
                rows = [buildVariantCreateData({ label: "Default", gender: "unisex", affiliateUrl, imageUrl: links.imageUrl }, 0)];
            }
            await tx.gearItemVariant.deleteMany({ where: { gearItemId: id } });
            if (rows && rows.length > 0) await tx.gearItemVariant.createMany({ data: rows.map((row) => ({ ...row, gearItemId: id })) });
        }

        const updated = await tx.gearItem.findUnique({ where: { id } });
        if (!updated) throw new GearItemNotFoundError();
        return updated;
    });
}

export async function deleteGearItem(id: string) {
    return prisma.gearItem.delete({
        where: { id },
    });
}

function mapGearItemForRecommendation(gearItem: GearItemRow & { variants?: GearVariantWriteInput[] }): GearItem {
    return {
        ...gearItem,
        weatherSuitability: {
            hot: gearItem.weatherHot ?? 0,
            warm: gearItem.weatherHot ?? 0,
            cold: gearItem.weatherCold ?? 0,
            rain: gearItem.weatherRain ?? 0,
            wind: gearItem.weatherWind ?? 0,
        },
        // Read-time containment: an unsafe stored link never leaves this mapping. Stored rows are not modified.
        affiliateUrl: containAffiliateUrl(gearItem.affiliateUrl),
        variants: (gearItem.variants ?? []).map((variant) => containVariantLink({ ...variant, gender: normalizeProductVariantGender(variant.gender) ?? "unisex" })),
        selectedVariant: selectProductVariant({ ...gearItem, variants: (gearItem.variants ?? []).map((variant) => ({ ...variant, gender: normalizeProductVariantGender(variant.gender) ?? "unisex" })) }),
    };
}

export async function listGearRecommendationCandidates(): Promise<GearItem[]> {
    const gearItems = await prisma.gearItem.findMany({
        include: {
            brand: true,
            variants: true,
        },
    });

    return gearItems.map((gearItem) => ({
        ...mapGearItemForRecommendation(gearItem),
        brandName: gearItem.brand.name,
    }));
}

export async function listWardrobeByUserId(userId: string) {
    return prisma.outfitItem.findMany({
        where: {
            outfit: {
                userId,
            },
        },
        include: {
            gearItem: {
                include: {
                    brand: true,
                    variants: true,
                }
            },
            outfit: true,
        },
        orderBy: {
            outfit: {
                createdAt: "desc",
            },
        },
    });
}