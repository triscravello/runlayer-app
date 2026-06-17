import { prisma } from "../lib/prisma.ts";
import { seedGearCatalog } from "./seeds/gear.seed.ts";
import { seedUserProfile } from "./seeds/user.seed.ts";
import { seedDemoOutfit } from "./seeds/outfit.seed.ts";

async function main() {
    await seedUserProfile();
    await seedGearCatalog();
    await seedDemoOutfit();
}

main()
    .then(() => {
        console.log("Database seed completed");
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });