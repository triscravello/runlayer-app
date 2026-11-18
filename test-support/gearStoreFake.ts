// A stateful, in-memory stand-in for the parts of Prisma the gear write path uses, plus barriers for forcing exact
// interleavings. Test-only; never imported by application code and never opens a connection.
//
// What it models faithfully enough for concurrency tests:
//   - findUnique({ where: { id }, select }) returns a SNAPSHOT of the row at call time (copied, so later writes cannot alter it).
//   - update({ where, data }) applies only keys whose value is not `undefined` (Prisma's own rule), handles the nested
//     `variants: { deleteMany: {}, create: [...] }` operation atomically, throws P2025 for a missing row and P2002 when the
//     (name, brandId) unique key would be violated.
//   - delete({ where }) throws P2025 for a missing row.
// Hooks run at the await points that matter: after a lookup returns, and before an update/delete is applied.
import { Prisma } from "@prisma/client";

export type FakeVariant = { id: string; gearItemId: string; label: string; gender: string; affiliateUrl: string | null; imageUrl: string | null; price: number | null; sizes: string[] };
export type FakeGearRow = {
    id: string; name: string; brandId: string; genderTarget: string | null; category: string; subcategory: string | null; priceRange: string;
    tags: string[]; bodyTypeFit: string[]; imageUrl: string | null; affiliateUrl: string | null;
    weatherHot: number | null; weatherCold: number | null; weatherRain: number | null; weatherWind: number | null;
    variants: FakeVariant[];
};
export type RecordedWrite = { op: "update" | "delete"; id: string; data?: Record<string, unknown> };

export function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

/** Releases every waiter only once `parties` of them have arrived: forces "both have read before either writes". */
export function barrier(parties: number) {
    let arrived = 0;
    const gate = deferred();
    return () => {
        arrived += 1;
        if (arrived >= parties) gate.resolve();
        return gate.promise;
    };
}

export function knownRequestError(code: "P2002" | "P2025" | "P2003") {
    return new Prisma.PrismaClientKnownRequestError(`fake ${code}`, { code, clientVersion: "test", meta: code === "P2002" ? { target: ["name", "brand_id"] } : undefined });
}

export function makeRow(overrides: Partial<FakeGearRow> & { id: string }): FakeGearRow {
    return {
        name: `Item ${overrides.id}`, brandId: "b1", genderTarget: "men", category: "TOP", subcategory: "tee", priceRange: "MID",
        tags: ["light"], bodyTypeFit: ["slim"], imageUrl: "https://e.test/i.png", affiliateUrl: "https://e.test/a",
        weatherHot: 0.4, weatherCold: 0.1, weatherRain: null, weatherWind: null,
        variants: [{ id: `v-${overrides.id}`, gearItemId: overrides.id, label: "Default", gender: "unisex", affiliateUrl: "https://e.test/a", imageUrl: null, price: 20, sizes: ["M"] }],
        ...overrides,
    };
}

export function createGearStore(initial: FakeGearRow[]) {
    const rows = new Map(initial.map((row) => [row.id, structuredClone(row)]));
    const writes: RecordedWrite[] = [];
    const calls: string[] = [];
    let nextVariant = 1;
    const hooks: {
        afterLookup?: (id: string) => Promise<void> | void;
        beforeUpdate?: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<void> | void;
        beforeDelete?: (id: string) => Promise<void> | void;
    } = {};

    const gearItem = {
        findMany: async () => { calls.push("findMany"); return [...rows.values()].map((row) => structuredClone({ ...row, createdAt: new Date(0), updatedAt: new Date(0), brand: { id: row.brandId, name: "Acme" } })); },
        findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, true> }) => {
            calls.push("findUnique");
            const row = rows.get(where.id);
            const snapshot = row ? structuredClone(Object.fromEntries(Object.keys(select).map((key) => [key, (row as Record<string, unknown>)[key]]))) : null;
            await hooks.afterLookup?.(where.id);
            return snapshot;
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
            calls.push("update");
            await hooks.beforeUpdate?.(args);
            const row = rows.get(args.where.id);
            if (!row) throw knownRequestError("P2025");
            writes.push({ op: "update", id: args.where.id, data: structuredClone(args.data) });
            const next = structuredClone(row) as Record<string, unknown>;
            for (const [key, value] of Object.entries(args.data)) {
                if (value === undefined) continue;
                if (key === "variants") {
                    const operation = value as { deleteMany?: unknown; create: Array<Record<string, unknown>> };
                    next.variants = operation.create.map((variant) => ({ id: `new-v${nextVariant++}`, gearItemId: row.id, price: null, imageUrl: null, affiliateUrl: null, ...Object.fromEntries(Object.entries(variant).filter(([, v]) => v !== undefined)) }));
                } else next[key] = value;
            }
            const clash = [...rows.values()].some((other) => other.id !== row.id && other.name === next.name && other.brandId === next.brandId);
            if (clash) throw knownRequestError("P2002");
            rows.set(row.id, next as FakeGearRow);
            return { id: row.id };
        },
        delete: async ({ where }: { where: { id: string } }) => {
            calls.push("delete");
            await hooks.beforeDelete?.(where.id);
            if (!rows.delete(where.id)) throw knownRequestError("P2025");
            writes.push({ op: "delete", id: where.id });
            return { id: where.id };
        },
    };

    return { gearItem, rows, writes, calls, hooks, get: (id: string) => rows.get(id) };
}
