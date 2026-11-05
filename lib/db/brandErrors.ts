// Pure error classification for brand writes (no database or framework imports).

type PrismaErrorLike = { name?: unknown; code?: unknown; meta?: unknown };

/**
 * True for a unique violation (P2002) on brands.name or brands.normalized_name.
 *
 * Two creators of equivalent names at the same moment race on BOTH unique indexes; PostgreSQL reports whichever it checks
 * first, so either one means "someone else just created this brand". The caller retries once, which then finds it. A P2002
 * on any other key is not a brand race and is not matched.
 */
export function isBrandUniqueConflict(error: unknown): boolean {
    const candidate = typeof error === "object" && error !== null ? (error as PrismaErrorLike) : null;
    if (!candidate || candidate.name !== "PrismaClientKnownRequestError" || candidate.code !== "P2002") return false;

    const meta = candidate.meta;
    const target = typeof meta === "object" && meta !== null ? (meta as { target?: unknown }).target : undefined;

    if (Array.isArray(target)) {
        const fields = target.map(String);
        return fields.length === 1 && ["name", "normalized_name", "normalizedName"].includes(fields[0]);
    }

    return typeof target === "string" && (target === "brands_name_key" || target === "brands_normalized_name_key");
}
