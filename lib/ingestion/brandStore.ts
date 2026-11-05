import type { Prisma } from "@prisma/client";
import {
    planBrandResolution,
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
// brands (for example the admin "create brand" endpoint) does not take the lock. That is why creation uses
// `upsert` on the unique name, so an exact-name collision with such a writer is harmless, and why step 4 re-reads
// and re-checks instead of trusting the plan. The one thing the database cannot enforce without a migration is
// case-insensitive uniqueness (brands_name_key is case-sensitive): two non-participating writers could still create
// "Nike" and "nike". If that ever happens, step 4 reports the brand as ambiguous instead of guessing.
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
                await tx.brand.upsert({ where: { name }, update: {}, create: { name } });
            }

            const current = plan.toCreate.length ? await tx.brand.findMany({ select: { id: true, name: true } }) : existing;
            // Every reference now either maps to an existing brand or fails; nothing is created a second time.
            return planBrandResolution(current, references, "require-existing").outcomes as ResolvedBrandOutcome[];
        },
        { maxWait: 5_000, timeout: 15_000 },
    );
}
