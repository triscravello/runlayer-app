// prisma/seeds/user.seed.ts
import { randomBytes, scryptSync } from "node:crypto";
import { prisma } from "../../lib/prisma.ts";

function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

export async function seedUserProfile() {
    const email = "user@example.com";
    const hashedPassword = hashPassword("Password123");
    
    const users = await prisma.$queryRaw<Array<{ id: string; email: string }>>`
        INSERT INTO users (id, email, password_hash, created_at, updated_at)
        VALUES ('user-id-1', ${email}, ${hashedPassword}, NOW(), NOW())
        ON CONFLICT (email)
        DO UPDATE SET updated_at = NOW(), password_hash = EXCLUDED.password_hash
        RETURNING id, email
    `;
    
    const user = users[0];
    
    if (!user) {
        throw new Error("Failed to seed user");
    }

    await prisma.userProfile.upsert({
        where: { userId: user.id },
        update: {
            location: "Denver, CO",
            genderPreference: "male",
        },
        create: {
            userId: user.id,
            location: "Denver, CO",
            heightCm: 180,
            weightLbs: 170,
            bodyType: "ATHLETIC",
            genderPreference: "male",
            heatSensitivity: "high",
            chafeProne: true,
            stylePreference: "performance",
            budgetLevel: "MID",
            preferredFit: "slim"
        }
    });
};

if (process.argv[1]?.endsWith("user.seed.ts")) {
    seedUserProfile()
        .catch((e) => {
            console.error(e);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}