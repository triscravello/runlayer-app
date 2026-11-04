// prisma/seeds/user.seed.ts
// Erasable TypeScript only; runs under `node --experimental-strip-types`.
import { hashPassword } from "../../lib/auth/password.ts";
import { disconnectSeedClient, prepareSeed, reportSeedFailure } from "./context.ts";
import type { SeedDeps } from "./context.ts";
import { SeedSafetyError, validateSeedPassword } from "./safety.ts";

// The seeded demo account uses the reserved example.com domain, so it can never collide with a real signup.
export const SEED_USER_EMAIL = "user@example.com";

/**
 * Creates the demo user (and profile) if it does not exist. CREATE-ONLY: an existing account is never modified,
 * and its password and profile are never overwritten. The password comes from SEED_USER_PASSWORD (no default).
 * Returns the real database id, which callers must use instead of any assumed id.
 */
export async function seedUserProfile(deps: SeedDeps = {}): Promise<{ userId: string; created: boolean }> {
    // Safety guard first: nothing below runs unless the target is a confirmed, dedicated, local database.
    const { prisma, env } = await prepareSeed(deps);

    // Validate the credential before any query, so a weak or missing password aborts with zero reads or writes.
    const password = env.SEED_USER_PASSWORD;
    const problem = validateSeedPassword(password, SEED_USER_EMAIL);
    if (problem || password === undefined) {
        throw new SeedSafetyError("invalid_password", problem ?? "SEED_USER_PASSWORD is required.");
    }

    const existing = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL }, select: { id: true } });
    if (existing) {
        console.log("Demo user already exists; left unchanged.");
        return { userId: existing.id, created: false };
    }

    try {
        const user = await prisma.user.create({
            data: {
                email: SEED_USER_EMAIL,
                passwordHash: hashPassword(password),
                profile: {
                    create: {
                        location: "Denver, CO",
                        heightCm: 180,
                        weightLbs: 170,
                        bodyType: "ATHLETIC",
                        genderPreference: "male",
                        heatSensitivity: "high",
                        chafeProne: true,
                        stylePreference: "performance",
                        budgetLevel: "MID",
                        preferredFit: "slim",
                    },
                },
            },
            select: { id: true },
        });

        console.log("Demo user created.");
        return { userId: user.id, created: true };
    } catch (error) {
        // Lost a race with another seed run: the account now exists, so leave it untouched.
        if ((error as { code?: unknown }).code === "P2002") {
            const raced = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL }, select: { id: true } });
            if (raced) return { userId: raced.id, created: false };
        }

        throw error;
    }
}

if (process.argv[1]?.endsWith("user.seed.ts")) {
    seedUserProfile()
        .catch((error) => {
            reportSeedFailure(error);
            process.exitCode = 1;
        })
        .finally(disconnectSeedClient);
}
