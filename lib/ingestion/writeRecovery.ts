// Pure helpers for gear-item writes: sanitized failure reasons and the single, verified recovery from a concurrent
// create. No database or framework imports so they can be unit tested and used from scripts.

type PrismaErrorLike = { name?: unknown; code?: unknown; meta?: unknown };

function asPrismaError(error: unknown): PrismaErrorLike | null {
    return typeof error === "object" && error !== null ? (error as PrismaErrorLike) : null;
}

function knownRequestCode(error: unknown): string | null {
    const candidate = asPrismaError(error);
    if (!candidate || candidate.name !== "PrismaClientKnownRequestError") return null;
    return typeof candidate.code === "string" && /^P\d{4}$/.test(candidate.code) ? candidate.code : null;
}

/**
 * Fixed, sanitized reason for a failed item write. Raw error messages are never returned: Prisma messages can
 * contain query arguments and other internals. Only a validated Prisma error code can appear in the output.
 */
export function safeWriteFailureReason(error: unknown): string {
    const code = knownRequestCode(error);
    if (code === "P2002") return "conflicting concurrent write";
    if (code === "P2003") return "brand reference rejected by database";
    if (code === "P2025") return "record no longer exists";
    if (code) return `database error (${code})`;
    return "unexpected error";
}

/**
 * True only for a P2002 whose violated constraint is the gear item's (name, brandId) unique key. A P2002 on any
 * other constraint (for example duplicate variants inside one item) is NOT a create race and must not be retried.
 * If Prisma reports no target at all, the caller's re-read of the row is what verifies the conflict.
 */
export function isGearCreateRace(error: unknown): boolean {
    if (knownRequestCode(error) !== "P2002") return false;

    const meta = asPrismaError(error)?.meta;
    const target = typeof meta === "object" && meta !== null ? (meta as { target?: unknown }).target : undefined;

    if (target === undefined || target === null) return true;
    if (Array.isArray(target)) {
        const fields = target.map(String);
        return fields.includes("name") && (fields.includes("brand_id") || fields.includes("brandId"));
    }
    if (typeof target === "string") {
        return target === "gear_items_name_brand_id_key" || (target.includes("name") && target.includes("brand_id"));
    }
    return false;
}

export type CreateRecoveryOperations<T> = {
    create: () => Promise<T>;
    // Re-reads the CURRENT row for the same (name, brandId). Called only after a verified create race.
    findExisting: () => Promise<{ id: string } | null>;
    update: (id: string) => Promise<T>;
};

/**
 * Creates an item. If, and only if, the create loses a verified race (P2002 on the item's unique key AND the
 * conflicting row is now readable), it re-reads that row and applies the write as an update, once. The update is
 * not retried: if it fails too, that error propagates and is reported as a sanitized failure.
 */
export async function createWithRaceRecovery<T>(operations: CreateRecoveryOperations<T>): Promise<{ action: "inserted" | "updated"; item: T }> {
    try {
        return { action: "inserted", item: await operations.create() };
    } catch (error) {
        if (!isGearCreateRace(error)) throw error;

        const current = await operations.findExisting();
        if (!current) throw error;

        return { action: "updated", item: await operations.update(current.id) };
    }
}
