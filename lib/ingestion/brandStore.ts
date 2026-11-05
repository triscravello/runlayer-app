import type { Prisma } from "@prisma/client";
import {
    planBrandResolution,
    toBrandIdentity,
    type BrandReference,
    type ResolvedBrandOutcome,
} from "./brandResolution";

// Database side of brand resolution for the CLI catalog import (policy "create-missing"). The admin API does not
// use this: it only ever looks brands up (see lib/validation/adminGearImport.ts).
//
// Everything happens in ONE short interactive transaction:
//   1. take a transaction-scoped PostgreSQL advisory lock,
//   2. read all brands and plan the resolution,
//   3. create the missing brands (sorted by key),
//   4. re-read the brands and resolve every reference to an actual brands.id.
//
// CONCURRENCY: the advisory lock only serialises importers that call this function. Anything else that writes
// brands (for example the admin "create brand" endpoint) does not take the lock. Since brands carry a unique,
// application-computed normalized key (brands.normalized_name), creation is an `upsert` on that key: two writers asking
// for equivalent names ("Nike", "nike", " NIKE ") end with exactly ONE row whether or not they hold the lock, so the
// lock is now defense in depth, not the only protection. Step 4 still re-reads and re-checks instead of trusting the
// plan, and the planner still reports a name shared by several existing brands as ambiguous instead of guessing: that
// can only happen with legacy or inconsistent data (for example rows written before the key existed), and that
// protection is deliberately kept.
//
// ATOMICITY: brand creation is committed here, before any gear item is written. Brand creation and item import are
// NOT one all-or-nothing transaction: if items later fail, the brands created for them remain. That is intentional
// (brands are idempotent reference data and are reused on the next run).

export const BRAND_RESOLUTION_LOCK_NAME = "runlayer:catalog-import:brand-resolution";

type BrandTransactionClient = Pick<Prisma.TransactionClient, "brand" | "$executeRaw">;

export type BrandTransactionRunner = {
    $transaction<T>(fn: (tx: BrandTransactionClient) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
};

export async function resolveImportBrands(references: BrandReference[], client: BrandTransactionRunner): Promise<ResolvedBrandOutcome[]> {
    if (references.length === 0) return [];

    return client.$transaction(
        async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BRAND_RESOLUTION_LOCK_NAME}))`;

            const existing = await tx.brand.findMany({ select: { id: true, name: true } });
            const plan = planBrandResolution(existing, references, "create-missing");

            for (const name of plan.toCreate) {
                // The stored key comes from the same function as every other writer. Looking the brand up by that
                // unique key makes the upsert atomic, and `update: {}` means an equivalent existing brand keeps its
                // display name.
                const identity = toBrandIdentity(name);
                if (!identity) throw new Error("A planned brand name failed validation.");
                await tx.brand.upsert({ where: { normalizedName: identity.normalizedName }, update: {}, create: identity });
            }

            const current = plan.toCreate.length ? await tx.brand.findMany({ select: { id: true, name: true } }) : existing;
            // Every reference now either maps to an existing brand or fails; nothing is created a second time.
            return planBrandResolution(current, references, "require-existing").outcomes as ResolvedBrandOutcome[];
        },
        { maxWait: 5_000, timeout: 15_000 },
    );
}
