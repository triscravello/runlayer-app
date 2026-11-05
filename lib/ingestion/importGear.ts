import { parseGearJsonFiles } from "./parsers/jsonGearParser";
import { mapGearItem } from "./mappers/gearMapper";
import { validateGearItem } from "./validators/gearValidator";
import type { BrandReference, ResolvedBrandOutcome } from "./brandResolution";
import type { GearImportResult, RawGearItemInput } from "./types";
import type { GearWriteInput } from "@/services/gearService";

type WriteResult = { inserted: number; updated: number; failed: Array<{ name: string; reason: string }> };

export type ImportGearDeps = {
    parseItems: () => Promise<unknown[]>;
    // Resolves (and, for this local CLI import, creates) brands. Returns one outcome per reference, same order.
    resolveBrands: (references: BrandReference[]) => Promise<ResolvedBrandOutcome[]>;
    bulkUpsert: (items: GearWriteInput[]) => Promise<WriteResult>;
};

// A row label that is safe to print: only a string, control characters removed, bounded length.
function safeLabel(value: unknown): string {
    if (typeof value !== "string") return "unknown";
    const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, 80);
    return cleaned || "unknown";
}

// Database-backed defaults are loaded lazily so that importing this module (for example in unit tests) never loads
// the Prisma client, and the CLI's safety guard keeps running before any database code is imported.
const defaultDeps: ImportGearDeps = {
    parseItems: () => parseGearJsonFiles(),
    resolveBrands: async (references) => {
        const [{ prisma }, { resolveImportBrands }] = await Promise.all([import("@/lib/prisma"), import("./brandStore")]);
        return resolveImportBrands(references, prisma);
    },
    bulkUpsert: async (items) => {
        const { bulkUpsertGearItems } = await import("@/services/gearService");
        return bulkUpsertGearItems(items);
    },
};

// Failure semantics (also documented in the README):
//  - invalid rows and rows whose brand cannot be resolved are reported in `failed` and never written;
//  - brands are created in their own short transaction BEFORE any item is written;
//  - each item is then written atomically (item + variants), but the batch is best-effort: one failed item does not
//    roll back the others, and brand creation and item import are NOT one all-or-nothing transaction.
export async function importGear(overrides: Partial<ImportGearDeps> = {}): Promise<GearImportResult> {
    const deps: ImportGearDeps = { ...defaultDeps, ...overrides };
    const rawItems = await deps.parseItems();
    const failed: GearImportResult["failed"] = [];
    const mapped: ReturnType<typeof mapGearItem>[] = [];

    for (const raw of rawItems) {
        const errors = validateGearItem(raw);
        if (errors.length > 0) {
            failed.push({ name: safeLabel((raw as { name?: unknown } | null)?.name), reason: errors.join(", ") });
            continue;
        }

        mapped.push(mapGearItem(raw as RawGearItemInput));
    }

    const outcomes = await deps.resolveBrands(mapped.map((item) => item.brandRef));
    if (outcomes.length !== mapped.length) {
        throw new Error("brand resolution returned an unexpected number of results");
    }

    const writable: GearWriteInput[] = [];
    mapped.forEach((item, index) => {
        const outcome = outcomes[index];
        if (outcome.status !== "resolved") {
            failed.push({ name: safeLabel(item.name), reason: outcome.reason });
            return;
        }

        const { brandRef, ...rest } = item;
        void brandRef;
        writable.push({ ...rest, brandId: outcome.brandId, affiliateUrl: item.affiliateUrl });
    });

    const writeResult = writable.length ? await deps.bulkUpsert(writable) : { inserted: 0, updated: 0, failed: [] };

    return {
        processed: rawItems.length,
        inserted: writeResult.inserted,
        updated: writeResult.updated,
        failed: [...failed, ...writeResult.failed],
    };
}
