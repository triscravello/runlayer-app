// Orchestrates the seed. Kept separate from prisma/seed.ts (which executes on import) so tests can call it.
// Erasable TypeScript only; runs under `node --experimental-strip-types`.
import { prepareSeed } from "./context.ts";
import type { SeedDeps } from "./context.ts";
import { seedGearCatalog } from "./gear.seed.ts";
import { seedDemoOutfit } from "./outfit.seed.ts";
import { seedUserProfile } from "./user.seed.ts";

export async function runSeed(deps: SeedDeps = {}): Promise<void> {
    // The safety guard runs before anything else, then once more inside each seed step (so each step is also safe
    // when executed directly). Nothing is written unless the target is a confirmed, dedicated, local database.
    await prepareSeed(deps);

    const { userId } = await seedUserProfile(deps);
    await seedGearCatalog(deps);
    // Use the account's real database id instead of any assumed fixed id.
    await seedDemoOutfit({ ...deps, userId });
}
