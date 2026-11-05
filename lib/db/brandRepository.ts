import type { PrismaClient } from "@prisma/client";
import { toBrandIdentity } from "@/lib/ingestion/brandResolution";
import { prisma } from "@/lib/prisma";
import { isBrandUniqueConflict } from "./brandErrors";

// What the admin API exposes. The stored normalized key is an internal detail, so it is deliberately not selected: the
// JSON returned by GET/POST /api/admin/brands is exactly what it was before the key existed.
const BRAND_SELECT = { id: true, name: true, tier: true, style: true, createdAt: true, updatedAt: true } as const;

export type BrandRow = Awaited<ReturnType<typeof listBrands>>[number];

type CreateBrandInput = {
    name: string;
    tier?: string | null;
    style?: string | null;
};

export type BrandWriter = Pick<PrismaClient, "brand">;

/** Raised for text that cannot be a brand name. The API validates first (adminBrand.ts), so this is a safety net. */
export class InvalidBrandNameError extends Error {
    constructor() {
        super("Brand name must be 1-100 characters with no control characters.");
        this.name = "InvalidBrandNameError";
    }
}

export async function listBrands() {
    return prisma.brand.findMany({
        select: BRAND_SELECT,
        orderBy: { name: "asc" },
    });
}

/**
 * Creates a brand, or returns the existing equivalent one. "Equivalent" means the same normalized key, so asking for
 * "nike" when "Nike" exists returns "Nike" (updating tier/style only when given, as before) instead of creating a twin.
 *
 * - The lookup is by the unique normalized key, which makes the upsert atomic: concurrent requests for equivalent names
 *   end with exactly one row. If Prisma cannot use a native upsert and loses a race, the unique-violation is retried once;
 *   the retry then finds the winner's row.
 * - An existing brand's display name is never rewritten here. A future rename must write `name` AND `normalizedName`
 *   together, built with toBrandIdentity(), in one statement.
 * - The caller's success contract is unchanged: it always gets the brand row back.
 */
export async function createBrand(input: CreateBrandInput, client: BrandWriter = prisma) {
    const identity = toBrandIdentity(input.name);
    if (!identity) throw new InvalidBrandNameError();

    const tier = input.tier?.trim() || undefined;
    const style = input.style?.trim() || undefined;

    const write = () =>
        client.brand.upsert({
            where: { normalizedName: identity.normalizedName },
            update: { tier, style },
            create: { ...identity, tier: tier ?? null, style: style ?? null },
            select: BRAND_SELECT,
        });

    try {
        return await write();
    } catch (error) {
        if (!isBrandUniqueConflict(error)) throw error;
        return write();
    }
}
