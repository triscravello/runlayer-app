// prisma/seeds/outfit.seed.ts
// Erasable TypeScript only; runs under `node --experimental-strip-types`.
import { disconnectSeedClient, prepareSeed, reportSeedFailure } from "./context.ts";
import type { SeedDeps } from "./context.ts";
import { SEED_USER_EMAIL } from "./user.seed.ts";

export const DEMO_OUTFIT_NAME = "Hot Weather Tempo Run";

/**
 * Creates the demo saved outfit for the demo user if it does not already exist. CREATE-ONLY and keyed by the
 * user's real database id (passed in, or looked up by email), never by an assumed fixed id.
 */
export async function seedDemoOutfit(deps: SeedDeps & { userId?: string } = {}): Promise<{ created: boolean }> {
    // Safety guard first.
    const { prisma } = await prepareSeed(deps);

    const userId = deps.userId ?? (await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL }, select: { id: true } }))?.id;
    if (!userId) {
        throw new Error("The demo user does not exist; run the user seed first.");
    }

    const existing = await prisma.savedOutfit.findFirst({ where: { userId, name: DEMO_OUTFIT_NAME }, select: { id: true } });
    if (existing) {
        console.log("Demo outfit already exists; left unchanged.");
        return { created: false };
    }

    await prisma.savedOutfit.create({ data: { userId, name: DEMO_OUTFIT_NAME, isFavorite: true } });
    console.log("Demo outfit created.");

    return { created: true };
}

if (process.argv[1]?.endsWith("outfit.seed.ts")) {
    seedDemoOutfit()
        .catch((error) => {
            reportSeedFailure(error);
            process.exitCode = 1;
        })
        .finally(disconnectSeedClient);
}
