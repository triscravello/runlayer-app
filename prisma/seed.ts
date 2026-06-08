import { prisma } from "@/lib/prisma";
import { seedGearCatalog } from "./seeds/gear.seed";
import { seedUserProfile } from "./seeds/user.seed";
import { seedDemoOutfit } from "./seeds/outfit.seed";

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