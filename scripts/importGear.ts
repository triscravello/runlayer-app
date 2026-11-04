import { describeErrorForLog } from "../lib/auth/logSafe";
import { assertSafeSeedTarget, SeedSafetyError } from "../prisma/seeds/safety";

// Imports the gear catalog from content/gear/*.json into a DEDICATED LOCAL database. It uses the same safety guard
// as the seed scripts (a confirmed, dedicated, loopback database; production, hosted databases and tunnels are
// refused) and has no force or override option. To load a catalog into a hosted environment use the authenticated
// admin import (POST /api/admin/gear/import).
async function run() {
  if (process.argv.includes("--force")) {
    throw new SeedSafetyError("production", "--force is no longer supported: the import cannot bypass its safety checks.");
  }

  // The safety guard runs before the import code (and its database client) is even loaded.
  await assertSafeSeedTarget();

  const { importGear } = await import("../lib/ingestion/importGear");
  const result = await importGear();

  console.log("Gear import finished");
  console.log(`Total processed: ${result.processed}`);
  console.log(`Inserted: ${result.inserted}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Errors: ${result.failed.length}`);

  if (result.failed.length) {
    console.log("Error details:");
    for (const failure of result.failed) {
      console.log(`- ${failure.name}: ${failure.reason}`);
    }
  }
}

run().catch((error) => {
  if (error instanceof SeedSafetyError) {
    console.error(`Gear import refused: ${error.message}`);
  } else {
    console.error(`Gear import failed: ${describeErrorForLog(error)}`);
  }
  process.exit(1);
});
