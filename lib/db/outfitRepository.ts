import type { Prisma } from "@prisma/client";
import { RECOMMENDATION_ENGINE_VERSION } from "@/config/recommendationEngineVersion";
import { OUTFIT_ID_MAX_LENGTH, OUTFIT_MAX_GEAR_ITEMS, normalizeKitType, type KitType } from "@/lib/validation/outfitLimits";
import { prisma } from "../prisma";

type JsonInputValue = Prisma.InputJsonValue;
export type SavedKitType = "race-day" | "intervals" | "long-run" | "trail" | "rain" | "cold-weather" | "summer" | "favorites" | "race_day" | "training" | "custom"

export type CreateRecommendationInput = {
    userId: string;
    weatherSnapshotId?: string | null;
    inputContext: JsonInputValue;
    output: JsonInputValue;
    topScore?: number | null;
    algorithmVersion?: string | null;
    engineVersion?: string | null;
    generatedAt?: Date | string | null;
};

export type SaveOutfitInput = {
    userId: string;
    recommendationId?: string | null;
    name?: string | null;
    description?: string | null;
    category?: SavedKitType | string | null;
    type?: SavedKitType | string | null;
    isFavorite?: boolean | null;
    gearItemIds?: string[] | null;
};

export class OutfitValidationError extends Error {
    constructor(message: string, public readonly statusCode = 400) {
        super(message);
        this.name = "OutfitValidationError";
    }
}

export type UpdateSavedOutfitInput = {
    userId: string;
    outfitId: string;
    name?: string | null;
    description?: string | null;
    category?: SavedKitType | string | null;
    type?: SavedKitType | string | null;
    isFavorite?: boolean | null;
    gearItemIds?: string[] | null;
};

// --- Transaction plumbing -----------------------------------------------------------------------------------------
//
// Every outfit mutation runs inside ONE interactive transaction on the client passed in (the shared Prisma client by
// default; tests pass a fake). Metadata and items are written together or not at all: any failure rolls both back.
//
// LOCKING PROTOCOL for items. Outfit items are only ever replaced through replaceOutfitItems(), which requires a
// LockedOutfit. The only way to obtain one is lockOwnedOutfit(), which runs
//     SELECT id FROM saved_outfits WHERE id = $outfit AND user_id = $user FOR UPDATE
// inside the same transaction. That single statement proves ownership and makes concurrent updates of the same outfit
// queue up, so two replacements can never interleave (delete, delete, create, create) and duplicate items.
// Semantics stay last-write-wins: the second update simply applies after the first commits. The lock covers only
// callers that follow this protocol, which is why it is the only code path that touches outfit_items writes.

type OutfitTx = Pick<Prisma.TransactionClient, "savedOutfit" | "outfitItem" | "gearItem" | "recommendation" | "$queryRaw">;

export type OutfitTransactionRunner = {
    $transaction<T>(fn: (tx: OutfitTx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
};

const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

declare const lockedBrand: unique symbol;
type LockedOutfit = { readonly tx: OutfitTx; readonly outfitId: string; readonly [lockedBrand]: true };

async function lockOwnedOutfit(tx: OutfitTx, userId: string, outfitId: string): Promise<LockedOutfit | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM saved_outfits WHERE id = ${outfitId} AND user_id = ${userId} FOR UPDATE`;
    if (rows.length !== 1) return null;
    return { tx, outfitId } as LockedOutfit;
}

type PrismaErrorLike = { name?: unknown; code?: unknown; meta?: unknown };

function prismaErrorCode(error: unknown): string | null {
    const candidate = typeof error === "object" && error !== null ? (error as PrismaErrorLike) : null;
    if (!candidate || candidate.name !== "PrismaClientKnownRequestError") return null;
    return typeof candidate.code === "string" && /^P\d{4}$/.test(candidate.code) ? candidate.code : null;
}

/**
 * Converts a foreign-key failure that happens when a referenced row disappears mid-transaction into a controlled,
 * fixed-message error. Anything else is returned unchanged. Messages never include client-supplied values.
 */
export function mapOutfitWriteError(error: unknown): unknown {
    if (error instanceof OutfitValidationError) return error;

    if (prismaErrorCode(error) === "P2003") {
        const meta = (error as PrismaErrorLike).meta;
        const field = String(typeof meta === "object" && meta !== null ? (meta as { field_name?: unknown }).field_name ?? "" : "");
        if (/recommendation/i.test(field)) return new OutfitValidationError("Recommendation not found for this user.", 404);
        if (/gear_item/i.test(field)) return new OutfitValidationError("A selected gear item is no longer available.", 409);
        return new OutfitValidationError("A referenced record is no longer available.", 409);
    }

    return error;
}

async function runOutfitTransaction<T>(client: OutfitTransactionRunner, work: (tx: OutfitTx) => Promise<T>): Promise<T> {
    try {
        return await client.$transaction(work, TRANSACTION_OPTIONS);
    } catch (error) {
        throw mapOutfitWriteError(error);
    }
}

// --- Validation helpers -------------------------------------------------------------------------------------------

function resolveKitType(raw: string | null | undefined): KitType | undefined {
    if (raw === null || raw === undefined) return undefined;
    const kitType = normalizeKitType(raw);
    if (!kitType) throw new OutfitValidationError("Unsupported kit type.", 400);
    return kitType;
}

/** Trims, bounds and de-duplicates gear ids (order kept). Never echoes an id back. */
function validateGearItemIds(gearItemIds: readonly string[]): string[] {
    if (!Array.isArray(gearItemIds) || gearItemIds.length === 0) throw new OutfitValidationError("Select at least one gear item.", 400);
    if (gearItemIds.length > OUTFIT_MAX_GEAR_ITEMS) throw new OutfitValidationError(`A kit can contain at most ${OUTFIT_MAX_GEAR_ITEMS} gear items.`, 400);

    const ids = gearItemIds.map((id) => (typeof id === "string" ? id.trim() : ""));
    if (ids.some((id) => id.length === 0 || id.length > OUTFIT_ID_MAX_LENGTH)) throw new OutfitValidationError("Invalid gear item id.", 400);

    return [...new Set(ids)];
}

async function loadGearItems(tx: OutfitTx, ids: string[]) {
    const found = await tx.gearItem.findMany({ where: { id: { in: ids } }, select: { id: true, category: true } });
    const byId = new Map(found.map((gearItem) => [gearItem.id, gearItem]));

    if (byId.size !== ids.length) throw new OutfitValidationError("One or more selected gear items do not exist.", 400);

    return ids.map((id) => byId.get(id)!);
}

type GearItemForOutfit = Awaited<ReturnType<typeof loadGearItems>>[number];

// Order-insensitive comparison of the stored gear ids with the requested (already de-duplicated) gear items.
function isSameGearSet(storedIds: readonly string[], requested: readonly GearItemForOutfit[]): boolean {
    const stored = new Set(storedIds);
    return stored.size === requested.length && requested.every((gearItem) => stored.has(gearItem.id));
}

// The ONLY function that writes outfit_items. It needs a LockedOutfit, i.e. the outfit row lock must be held.
async function replaceOutfitItems(locked: LockedOutfit, gearItems: GearItemForOutfit[]) {
    await locked.tx.outfitItem.deleteMany({ where: { outfitId: locked.outfitId } });
    await locked.tx.outfitItem.createMany({
        data: gearItems.map((gearItem) => ({
            outfitId: locked.outfitId,
            gearItemId: gearItem.id,
            category: gearItem.category,
        })),
    });
}

// --- Reads --------------------------------------------------------------------------------------------------------

const OUTFIT_INCLUDE = {
    recommendation: true,
    OutfitItem: {
        include: {
            gearItem: { include: { brand: true, variants: true } },
        },
    },
} as const;

export async function listSavedOutfitsByUserId(userId: string) {
    return prisma.savedOutfit.findMany({
        where: { userId },
        include: {
            recommendation: true,
            OutfitItem: {
                include: {
                    gearItem: {
                        include: { brand: true, variants: true },
                    },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function getSavedOutfitById(userId: string, outfitId: string) {
    return prisma.savedOutfit.findFirst({
        where: { id: outfitId, userId },
        include: OUTFIT_INCLUDE,
    });
}

function readOutfit(tx: OutfitTx, userId: string, outfitId: string) {
    return tx.savedOutfit.findFirst({ where: { id: outfitId, userId }, include: OUTFIT_INCLUDE });
}

// --- Mutations ----------------------------------------------------------------------------------------------------

/**
 * Creates an outfit and its items atomically. Everything is validated before the first write: input shape, kit type,
 * recommendation ownership and gear existence. A failure at any point leaves no outfit behind.
 */
export async function saveOutfit(input: SaveOutfitInput, client: OutfitTransactionRunner = prisma) {
    // Pure validation first: nothing here touches the database.
    const gearItemIds = validateGearItemIds(input.gearItemIds ?? []);
    const kitType = resolveKitType(input.category ?? input.type) ?? "favorites";

    return runOutfitTransaction(client, async (tx) => {
        if (input.recommendationId) {
            const recommendation = await tx.recommendation.findFirst({
                where: { id: input.recommendationId, userId: input.userId },
                select: { id: true },
            });

            if (!recommendation) {
                throw new OutfitValidationError("Recommendation not found for this user.", 404);
            }
        }

        const gearItems = await loadGearItems(tx, gearItemIds);

        const savedOutfit = await tx.savedOutfit.create({
            data: {
                userId: input.userId,
                recommendationId: input.recommendationId || null,
                name: input.name ?? "Saved Kit",
                description: input.description ?? null,
                type: kitType,
                isFavorite: input.isFavorite ?? false,
            },
        });

        // Same protocol as update: take the row lock, then replace items through the single code path.
        const locked = await lockOwnedOutfit(tx, input.userId, savedOutfit.id);
        if (!locked) throw new Error("Saved outfit was not visible to its own transaction.");
        await replaceOutfitItems(locked, gearItems);

        const created = await readOutfit(tx, input.userId, savedOutfit.id);
        if (!created) throw new Error("Saved outfit could not be read back.");
        return created;
    });
}

/**
 * Updates an owned outfit atomically (last write wins). Returns null if the outfit does not exist or belongs to
 * someone else. Order: lock the owned row, validate every reference, then write metadata and items together.
 */
export async function updateSavedOutfit(input: UpdateSavedOutfitInput, client: OutfitTransactionRunner = prisma) {
    const gearItemIds = input.gearItemIds === undefined || input.gearItemIds === null ? null : validateGearItemIds(input.gearItemIds);
    const kitType = resolveKitType(input.category ?? input.type);

    return runOutfitTransaction(client, async (tx) => {
        const locked = await lockOwnedOutfit(tx, input.userId, input.outfitId);
        if (!locked) return null;

        // What is stored right now, read under the row lock so it cannot change before we write. It tells us what is
        // a real change and what is a no-op.
        const current = await tx.savedOutfit.findFirst({
            where: { id: input.outfitId, userId: input.userId },
            select: { name: true, description: true, type: true, isFavorite: true, OutfitItem: { select: { gearItemId: true } } },
        });
        if (!current) return null;

        // Validate references before the first write, so a bad id never leaves a half-applied update.
        const gearItems = gearItemIds ? await loadGearItems(tx, gearItemIds) : null;

        const metadata = {
            ...(input.name !== undefined && input.name !== current.name ? { name: input.name } : {}),
            ...(input.description !== undefined && input.description !== current.description ? { description: input.description } : {}),
            ...(kitType !== undefined && kitType !== current.type ? { type: kitType } : {}),
            ...(input.isFavorite !== undefined && (input.isFavorite ?? false) !== current.isFavorite ? { isFavorite: input.isFavorite ?? false } : {}),
        };
        const itemsChanged = gearItems !== null && !isSameGearSet(current.OutfitItem.map((entry) => entry.gearItemId), gearItems);

        // A no-op (nothing supplied, or everything supplied already matches) writes nothing and leaves updatedAt alone.
        if (Object.keys(metadata).length === 0 && !itemsChanged) {
            return readOutfit(tx, input.userId, input.outfitId);
        }

        // One write advances updatedAt for any real change, including an item-only change (which has no metadata
        // column to touch). It is in the same transaction as the item replacement, so a rollback restores it too.
        await tx.savedOutfit.updateMany({ where: { id: input.outfitId, userId: input.userId }, data: { ...metadata, updatedAt: new Date() } });

        if (gearItems && itemsChanged) await replaceOutfitItems(locked, gearItems);

        return readOutfit(tx, input.userId, input.outfitId);
    });
}

export async function deleteSavedOutfitById(userId: string, outfitId: string) {
    return prisma.savedOutfit.deleteMany({ where: { id: outfitId, userId } });
}

export async function listGeneratedOutfits() {
    return prisma.recommendation.findMany({
        orderBy: { createdAt: "desc" },
        include: { user: true, weatherSnapshot: true },
    });
}

export async function createGeneratedOutfit(input: CreateRecommendationInput) {
    const engineVersion = input.engineVersion ?? input.algorithmVersion ?? RECOMMENDATION_ENGINE_VERSION;

    return prisma.recommendation.create({
        data: {
            userId: input.userId,
            weatherSnapshotId: input.weatherSnapshotId ?? null,
            inputContext: input.inputContext,
            output: input.output,
            topScore: input.topScore ?? null,
            algorithmVersion: input.algorithmVersion ?? engineVersion,
            engineVersion,
            generatedAt: input.generatedAt ? new Date(input.generatedAt) : undefined,
            versionMetadata: {
                create: {
                    engineVersion,
                    timestamp: input.generatedAt ? new Date(input.generatedAt) : undefined
                },
            },
        },
    });
}

export async function listOutfitHistoryByUserId(userId: string) {
    return prisma.recommendation.findMany({
        where: { userId },
        include: { savedOutfits: true, weatherSnapshot: true },
        orderBy: { createdAt: "desc" },
    });
}
