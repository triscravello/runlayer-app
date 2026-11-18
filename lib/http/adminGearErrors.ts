import { GearItemNotFoundError, GearItemStaleVersionError } from "@/lib/gear/inputErrors";
import { knownRequestCode } from "@/lib/ingestion/writeRecovery";
import { ConflictError, NotFoundError } from "./apiErrors";

/**
 * Narrow mapping for admin gear writes. Only four cases are translated, each to a fixed message that names no id, version, value or
 * database detail; everything else is rethrown untouched so existing responses (400s from validation, 500s) do not change. In
 * particular a transaction timeout (Prisma P2028) is neither "stale" nor "not found" and stays an unmapped failure.
 *   - the expected version no longer matches (typed)     -> 409 STALE_VERSION  (the item changed since the caller read it)
 *   - the item does not exist (service lookup)           -> 404
 *   - Prisma P2025, record to update/delete not found    -> 404  (the item vanished after the lookup, or a DELETE of a missing id)
 *   - Prisma P2002, unique constraint violated           -> 409 CONFLICT  (only when `conflict` is allowed, i.e. for updates)
 */
export function mapAdminGearWriteError(error: unknown, { conflict = false }: { conflict?: boolean } = {}): never {
    if (error instanceof GearItemStaleVersionError) throw new ConflictError("Gear item was changed by someone else", "STALE_VERSION");
    if (error instanceof GearItemNotFoundError) throw new NotFoundError("Gear item not found");
    const code = knownRequestCode(error);
    if (code === "P2025") throw new NotFoundError("Gear item not found");
    if (conflict && code === "P2002") throw new ConflictError("Gear item conflicts with an existing item");
    throw error;
}
