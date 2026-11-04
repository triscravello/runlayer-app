// Entry point for `prisma db seed` (see "prisma.seed" in package.json). Runs under
// `node --experimental-strip-types`. The safety guard in prisma/seeds/safety.ts runs before any database write
// and has no override: only a confirmed, dedicated, local database can be seeded.
import { disconnectSeedClient, reportSeedFailure } from "./seeds/context.ts";
import { runSeed } from "./seeds/run.ts";

runSeed()
    .then(() => {
        console.log("Database seed completed");
    })
    .catch((error) => {
        reportSeedFailure(error);
        process.exitCode = 1;
    })
    .finally(disconnectSeedClient);
