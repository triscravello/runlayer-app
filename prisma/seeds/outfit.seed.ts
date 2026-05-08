// prisma/seeds/outfit.seed.ts
import { prisma } from "../../lib/prisma";

async function main() {
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

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    })