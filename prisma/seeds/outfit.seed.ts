// prisma/seeds/outfit.seed.ts
import { prisma } from "../../lib/prisma";

export async function seedDemoOutfit() {
    const outfit = await prisma.savedOutfit.upsert({
        where: { id: "outfit-id-1" },
        update: {},
        create: {
            id: "outfit-id-1",
            userId: "user-id-1",
            name: "Hot Weather Tempo Run",
            isFavorite: true,
        }
    });

    console.log("Seeded outfit:", outfit);
};

if (process.argv[1]?.endsWith("outfit.seed.ts")) {
    seedDemoOutfit()
        .catch((e) => {
            console.error(e);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}