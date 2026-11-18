// A stateful, in-memory stand-in for the parts of Prisma the gear write path uses, plus barriers for forcing exact
// interleavings. Test-only; never imported by application code and never opens a connection.
//
// IMPORTANT: this fake MODELS PostgreSQL behavior, it does not prove it. The model is: an UPDATE takes a row lock that is held
// until the transaction ends; another writer of that row waits, then re-evaluates its WHERE against the committed row (READ
// COMMITTED); plain reads never wait and see only committed data. Whether the real database and Prisma 5.22 behave this way is
// what the opt-in local PostgreSQL proof is for. Passing these tests shows the application logic is correct GIVEN that model.
//
// What it models:
//   - $transaction(fn): an interactive transaction. Writes go to a private overlay and become visible only on commit; a throw
//     from `fn` rolls everything back (nothing committed, locks released).
//   - tx.gearItem.updateMany({ where: { id, version? }, data }): waits while another transaction holds the row, then matches
//     only if the row exists and (when given) its version equals `where.version`; applies only keys that are not `undefined`,
//     honours `version: { increment }`; takes the row lock only when it matches; throws P2002 on a (name, brandId) clash.
//   - tx.gearItem.findUnique, tx.gearItemVariant.deleteMany / createMany (createMany throws P2002 on a duplicate label+gender
//     and requires the caller to hold the row lock, so an unlocked variant write is a test failure).
//   - gearItem.delete({ where }): waits for a lock holder, then deletes (P2025 when missing); variants go with the row.
//   - gearItem.findMany / findUnique outside a transaction: committed state only.
// Hooks run at the await points that matter and let a test park a transaction while it holds the lock.
import { Prisma } from "@prisma/client";

export type FakeVariant = { id: string; gearItemId: string; label: string; gender: string; affiliateUrl: string | null; imageUrl: string | null; price: number | null; sizes: string[] };
export type FakeGearRow = {
    id: string; name: string; brandId: string; genderTarget: string | null; category: string; subcategory: string | null; priceRange: string;
    tags: string[]; bodyTypeFit: string[]; imageUrl: string | null; affiliateUrl: string | null;
    weatherHot: number | null; weatherCold: number | null; weatherRain: number | null; weatherWind: number | null;
    version: number;
    variants: FakeVariant[];
};
/** One DURABLE (committed) write. `data` is what the item update carried, without the version/updatedAt bookkeeping; `variants` lists replaced labels. */
export type RecordedWrite = { op: "update" | "delete"; id: string; data?: Record<string, unknown>; variants?: string[]; expectedVersion?: number };

export function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

/** Releases every waiter only once `parties` of them have arrived. */
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
        version: 0,
        variants: [{ id: `v-${overrides.id}`, gearItemId: overrides.id, label: "Default", gender: "unisex", affiliateUrl: "https://e.test/a", imageUrl: null, price: 20, sizes: ["M"] }],
        ...overrides,
    };
}

type Tx = { n: number; overlay: Map<string, FakeGearRow | null>; locks: Set<string>; pending: RecordedWrite[]; open: boolean };

export function createGearStore(initial: FakeGearRow[]) {
    const rows = new Map(initial.map((row) => [row.id, structuredClone(row)]));
    const writes: RecordedWrite[] = [];
    const calls: string[] = [];
    const locks = new Map<string, { owner: number; released: ReturnType<typeof deferred<void>> }>();
    let nextVariant = 1;
    let nextTx = 1;
    const state = { blocked: 0, begun: 0, committed: 0, rolledBack: 0 };
    /** The raw arguments of every updateMany call, as the application sent them (before the fake applies anything). */
    const updateManyCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
    const hooks: {
        /** After a findUnique has produced its snapshot, before it returns. */
        afterLookup?: (id: string) => Promise<void> | void;
        /** Inside updateMany, right after the row lock was taken and the change applied: park here to hold the lock. */
        afterLock?: (id: string) => Promise<void> | void;
        /** Inside delete, while it holds the row lock, before the row disappears. */
        beforeDelete?: (id: string) => Promise<void> | void;
        /** A writer started waiting for a lock held by another transaction (the analogue of a backend waiting on a Lock). */
        onBlocked?: (id: string) => void;
    } = {};

    const view = (tx: Tx | null, id: string) => (tx && tx.overlay.has(id) ? tx.overlay.get(id) ?? undefined : rows.get(id));

    async function waitUnlocked(id: string, tx: Tx | null) {
        for (;;) {
            const lock = locks.get(id);
            if (!lock || (tx && lock.owner === tx.n)) return;
            state.blocked += 1;
            hooks.onBlocked?.(id);
            await lock.released.promise;
            state.blocked -= 1;
        }
    }
    const take = (tx: Tx, id: string) => {
        if (!tx.locks.has(id)) { tx.locks.add(id); locks.set(id, { owner: tx.n, released: deferred() }); }
    };
    function finish(tx: Tx, commit: boolean) {
        tx.open = false;
        if (commit) {
            for (const [id, row] of tx.overlay) { if (row === null) rows.delete(id); else rows.set(id, row); }
            writes.push(...tx.pending);
            state.committed += 1;
        } else state.rolledBack += 1;
        for (const id of tx.locks) { const lock = locks.get(id); locks.delete(id); lock?.released.resolve(); }
        calls.push(commit ? "tx.commit" : "tx.rollback");
    }
    const selectKeys = (row: FakeGearRow, select?: Record<string, true>) => structuredClone(select ? Object.fromEntries(Object.keys(select).map((key) => [key, (row as Record<string, unknown>)[key]])) : row);

    function txClient(tx: Tx) {
        return {
            gearItem: {
                updateMany: async ({ where, data }: { where: { id: string; version?: number }; data: Record<string, unknown> }) => {
                    calls.push("updateMany");
                    updateManyCalls.push({ where: { ...where }, data: { ...data } });
                    await waitUnlocked(where.id, tx);
                    const row = view(tx, where.id);
                    if (!row || (where.version !== undefined && row.version !== where.version)) return { count: 0 };
                    take(tx, where.id);
                    const next = structuredClone(row) as Record<string, unknown>;
                    const recorded: Record<string, unknown> = {};
                    for (const [key, value] of Object.entries(data)) {
                        if (value === undefined) continue;
                        if (key === "version") { next.version = row.version + (value as { increment: number }).increment; continue; }
                        if (key === "updatedAt") continue;
                        next[key] = value;
                        recorded[key] = structuredClone(value);
                    }
                    const clash = [...rows.values()].some((other) => other.id !== row.id && other.name === next.name && other.brandId === next.brandId);
                    if (clash) throw knownRequestError("P2002");
                    tx.overlay.set(where.id, next as FakeGearRow);
                    tx.pending.push({ op: "update", id: where.id, data: recorded, ...(where.version !== undefined ? { expectedVersion: where.version } : {}) });
                    await hooks.afterLock?.(where.id);
                    return { count: 1 };
                },
                findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, true> }) => {
                    calls.push("findUnique");
                    const row = view(tx, where.id);
                    const snapshot = row ? selectKeys(row, select) : null;
                    await hooks.afterLookup?.(where.id);
                    return snapshot;
                },
            },
            gearItemVariant: {
                deleteMany: async ({ where }: { where: { gearItemId: string } }) => {
                    calls.push("variant.deleteMany");
                    const row = view(tx, where.gearItemId);
                    if (!row || !tx.locks.has(where.gearItemId)) throw new Error("fake: variant write without holding the parent row lock");
                    const next = structuredClone(row);
                    const count = next.variants.length;
                    next.variants = [];
                    tx.overlay.set(where.gearItemId, next);
                    const record = tx.pending.find((entry) => entry.op === "update" && entry.id === where.gearItemId);
                    if (record) record.variants = [];   // one durable record per transaction: the item update and its variant replacement
                    return { count };
                },
                createMany: async ({ data }: { data: Array<Record<string, unknown> & { gearItemId: string }> }) => {
                    calls.push("variant.createMany");
                    const id = data[0]?.gearItemId;
                    const row = id ? view(tx, id) : undefined;
                    if (!row || !tx.locks.has(id)) throw new Error("fake: variant write without holding the parent row lock");
                    const next = structuredClone(row);
                    for (const entry of data) {
                        if (next.variants.some((variant) => variant.label === entry.label && variant.gender === entry.gender)) throw knownRequestError("P2002");
                        next.variants.push({ id: `new-v${nextVariant++}`, price: null, imageUrl: null, affiliateUrl: null, sizes: [], ...(Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)) as object) } as unknown as FakeVariant);
                    }
                    tx.overlay.set(id, next);
                    const record = tx.pending.find((entry) => entry.op === "update" && entry.id === id);
                    if (record) record.variants = next.variants.map((variant) => variant.label);
                    return { count: data.length };
                },
            },
        };
    }

    const client = {
        $transaction: async <T>(fn: (tx: ReturnType<typeof txClient>) => Promise<T>): Promise<T> => {
            const tx: Tx = { n: nextTx++, overlay: new Map(), locks: new Set(), pending: [], open: true };
            state.begun += 1;
            calls.push("tx.begin");
            try {
                const result = await fn(txClient(tx));
                finish(tx, true);
                return result;
            } catch (error) {
                finish(tx, false);
                throw error;
            }
        },
        gearItem: {
            findMany: async () => { calls.push("findMany"); return [...rows.values()].map((row) => structuredClone({ ...row, createdAt: new Date(0), updatedAt: new Date(0), brand: { id: row.brandId, name: "Acme" } })); },
            findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, true> }) => {
                calls.push("findUnique");
                const row = rows.get(where.id);
                const snapshot = row ? selectKeys(row, select) : null;
                await hooks.afterLookup?.(where.id);
                return snapshot;
            },
            delete: async ({ where }: { where: { id: string } }) => {
                calls.push("delete");
                const tx: Tx = { n: nextTx++, overlay: new Map(), locks: new Set(), pending: [], open: true };
                await waitUnlocked(where.id, tx);
                if (!rows.has(where.id)) throw knownRequestError("P2025");
                take(tx, where.id);
                try {
                    await hooks.beforeDelete?.(where.id);
                    tx.overlay.set(where.id, null);
                    tx.pending.push({ op: "delete", id: where.id });
                    finish(tx, true);
                } catch (error) {
                    finish(tx, false);
                    throw error;
                }
                return { id: where.id };
            },
        },
    };

    return { ...client, rows, writes, calls, hooks, state, updateManyCalls, get: (id: string) => rows.get(id), lockedIds: () => [...locks.keys()] };
}

/** The fields a write carried, without the bookkeeping (`version`, `updatedAt`) that every update adds. */
export const fieldsOf = (write: RecordedWrite) => Object.keys(write.data ?? {});

// ---------------------------------------------------------------------------------------------------------------------
// Recording client for tests that only inspect WHAT would be written (payload-shape and validation tests with their own
// hand-written fake Prisma). It has no concurrency model. It reassembles the classic `{ where: { id }, data }` update record
// from the transaction's calls: scalar fields as sent (without the version/updatedAt bookkeeping) and, when variants were
// replaced, `data.variants = { deleteMany: {}, create: [...] }`. A transaction whose callback throws records nothing, exactly
// like a rolled-back transaction.
// ---------------------------------------------------------------------------------------------------------------------
export type LegacyUpdateRecord = { where: { id: string }; data: Record<string, unknown>; expectedVersion?: number };
type RecordedRow = { id?: string; affiliateUrl?: string | null; imageUrl?: string | null; version?: number } & Record<string, unknown>;

export function createRecordingGearClient(updates: LegacyUpdateRecord[], rowFor: (id: string) => RecordedRow | null | undefined = (id) => ({ id, affiliateUrl: null, imageUrl: null, version: 0 })) {
    const pick = (row: RecordedRow, select?: Record<string, true>) => (select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : { ...row });
    return {
        $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
            let record: LegacyUpdateRecord | null = null;
            let written: Record<string, unknown> = {};   // read-your-writes: later reads in the same transaction see this update
            let replaced = false;
            const created: Array<Record<string, unknown>> = [];
            const tx = {
                gearItem: {
                    updateMany: async ({ where, data }: { where: { id: string; version?: number }; data: Record<string, unknown> }) => {
                        const row = rowFor(where.id);
                        if (!row || (where.version !== undefined && (row.version ?? 0) !== where.version)) return { count: 0 };
                        const { version, updatedAt, ...rest } = data;
                        void version; void updatedAt;
                        written = { ...written, ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)) };
                        record = { where: { id: where.id }, data: { ...rest }, ...(where.version !== undefined ? { expectedVersion: where.version } : {}) };
                        return { count: 1 };
                    },
                    findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, true> }) => {
                        const row = rowFor(where.id);
                        return row ? pick({ ...row, ...written }, select) : null;
                    },
                },
                gearItemVariant: {
                    deleteMany: async () => { replaced = true; return { count: 0 }; },
                    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
                        for (const { gearItemId, ...rest } of data) { void gearItemId; created.push(rest); }
                        return { count: data.length };
                    },
                },
            };
            const result = await fn(tx);
            if (record) {
                const finished: LegacyUpdateRecord = record;
                if (replaced) finished.data.variants = { deleteMany: {}, create: created };
                updates.push(finished);
            }
            return result;
        },
    };
}
