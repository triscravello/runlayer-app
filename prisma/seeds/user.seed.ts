// prisma/seeds/user.seed.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.upsert({
        where: { email: "user@example.com"},
        update: {},
        create: {
            id: "user-id-1",
            email: "user@example.com",
        }
    });

    const userProfile = await prisma.userProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: {
            userId: user.id,
            heightCm: 180,
            weightLbs: 170,
            bodyType: "athletic",
            heatSensitivity: "high",
            chafeProne: true,
            stylePreference: "performance",
            budgetLevel: "mid",
            preferredFit: "slim"
        }
    });

    console.log("Seeded user and profile:", { user, userProfile });
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

main().finally(async () => {
    await prisma.$disconnect();
});