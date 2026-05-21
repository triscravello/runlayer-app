import { importGear } from "@/lib/ingestion/importGear";

async function run() {
  const force = process.argv.includes("--force");
  if (process.env.NODE_ENV === "production" && !force) {
    throw new Error("Refusing to run import in production without --force flag");
  }

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
  console.error("Gear import failed", error);
  process.exit(1);
});