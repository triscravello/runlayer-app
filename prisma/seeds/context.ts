// Shared plumbing for the seed scripts. Erasable TypeScript only (runs under node --experimental-strip-types).
import type { PrismaClient } from "@prisma/client";
import { describeErrorForLog } from "../../lib/auth/logSafe.ts";
import { SeedSafetyError, assertSafeSeedTarget } from "./safety.ts";

export type SeedPrisma = Pick<PrismaClient, "user" | "savedOutfit" | "brand" | "gearItem">;

export type SeedDeps = {
    /** Database client. Defaults to the application client, loaded only after the safety guard has passed. */
    prisma?: SeedPrisma;
    /** The safety guard. Defaults to assertSafeSeedTarget(). Tests inject a spy or a rejecting guard. */
    assertSafe?: () => Promise<unknown>;
    env?: Readonly<Record<string, string | undefined>>;
};

let defaultClient: PrismaClient | undefined;

async function loadDefaultClient(): Promise<PrismaClient> {
    if (!defaultClient) {
        defaultClient = (await import("../../lib/prisma.ts")).prisma;
    }

    return defaultClient;
}

/**
 * Every seed function calls this FIRST. It runs the safety guard (which throws before any write if the target is
 * not a confirmed, dedicated, local database) and only then obtains the database client.
 */
export async function prepareSeed(deps: SeedDeps = {}): Promise<{ prisma: SeedPrisma; env: Readonly<Record<string, string | undefined>> }> {
    await (deps.assertSafe ?? (() => assertSafeSeedTarget()))();

    return { prisma: deps.prisma ?? (await loadDefaultClient()), env: deps.env ?? process.env };
}

export async function disconnectSeedClient(): Promise<void> {
    if (defaultClient) {
        await defaultClient.$disconnect();
    }
}

/** Prints a failure without leaking database error messages (they can contain query arguments such as password hashes). */
export function reportSeedFailure(error: unknown): void {
    if (error instanceof SeedSafetyError) {
        console.error(`Seed refused: ${error.message}`);
    } else {
        console.error(`Seed failed: ${describeErrorForLog(error)}`);
    }
}
