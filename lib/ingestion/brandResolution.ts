// Pure brand resolution shared by the CLI catalog import and the admin bulk import. No database, no framework
// imports: it only decides, from a list of existing brands, which database id (if any) each reference maps to.
//
// A brand reference is the pair a catalog row may carry: an explicit database id (`brandId`) and/or a brand name.
// Rules (in order):
//   1. An explicit id must equal an existing brands.id. It never creates anything.
//   2. If a name is also given it must normalise to the same brand as the id, otherwise the row conflicts.
//   3. A name is matched against existing brands by its normalised key (NFKC, trimmed, whitespace collapsed,
//      lowercased). Two or more existing brands with the same key make the reference ambiguous: we never pick one.
//   4. A name with no match is either reported (policy "require-existing") or planned for creation
//      (policy "create-missing"). The creation itself happens elsewhere (brandStore.ts).

export const BRAND_MAX_LENGTH = 100;

export type BrandReference = { id: string | null; name: string | null };
export type BrandRecord = { id: string; name: string };
export type BrandPolicy = "create-missing" | "require-existing";

// Fixed vocabulary: these strings are the only brand-related reasons that ever reach logs or API responses.
export const BRAND_FAILURE = {
    required: "brand is required",
    invalidName: "invalid brand value",
    invalidId: "invalid brandId value",
    unknownId: "unknown brandId",
    unknownBrand: "brand does not exist",
    conflict: "brand conflicts with brandId",
    ambiguous: "ambiguous brand",
} as const;

export type BrandFailureReason = (typeof BRAND_FAILURE)[keyof typeof BRAND_FAILURE];

export type BrandOutcome =
    | { status: "resolved"; brandId: string }
    | { status: "create"; key: string; name: string }
    | { status: "failed"; reason: BrandFailureReason };

export type ResolvedBrandOutcome = Exclude<BrandOutcome, { status: "create" }>;

export type BrandIndex = {
    byId: Map<string, BrandRecord>;
    byKey: Map<string, BrandRecord[]>;
};

export type BrandPlan = {
    // One outcome per input reference, in input order.
    outcomes: BrandOutcome[];
    // Distinct brands to create: one display name per key, ordered by key, independent of row order.
    toCreate: string[];
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Comparison key: two spellings of one brand ("Nike", " nike ", "NIKE") share it. */
export function normalizeBrandKey(value: string): string {
    return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Display name for a brand we create: exactly what was supplied, trimmed and with whitespace collapsed. */
export function cleanBrandName(value: string): string {
    return value.trim().replace(/\s+/g, " ");
}

type TextCheck = { ok: true; value: string } | { ok: false };

/** A usable brand string: a non-empty string of at most BRAND_MAX_LENGTH characters with no control characters. */
export function checkBrandText(value: unknown): TextCheck {
    if (typeof value !== "string") return { ok: false };
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > BRAND_MAX_LENGTH || CONTROL_CHARACTERS.test(trimmed)) return { ok: false };
    return { ok: true, value: trimmed };
}

export const BRAND_KEY_MAX_LENGTH = BRAND_MAX_LENGTH;

/** What every brand row is written with: the display name and the stored identity key. */
export type BrandIdentity = { name: string; normalizedName: string };

/**
 * THE one way a brand row gets its display name and its stored key. Every writer (CLI import, admin API, seed, and any
 * future rename - which must write BOTH fields in one statement) builds the data from this function, so the stored key
 * is always `normalizeBrandKey` of the same text. Returns null for text that cannot be a brand: not a string, blank,
 * over BRAND_MAX_LENGTH, containing control characters, or whose key is empty or longer than BRAND_KEY_MAX_LENGTH
 * (NFKC can expand a name, so a valid-looking name may still produce an over-long key).
 */
export function toBrandIdentity(value: unknown): BrandIdentity | null {
    const text = checkBrandText(value);
    if (!text.ok) return null;

    const normalizedName = normalizeBrandKey(text.value);
    if (normalizedName === "" || normalizedName.length > BRAND_KEY_MAX_LENGTH) return null;

    return { name: cleanBrandName(text.value), normalizedName };
}

export function buildBrandIndex(brands: readonly BrandRecord[]): BrandIndex {
    const byId = new Map<string, BrandRecord>();
    const byKey = new Map<string, BrandRecord[]>();

    for (const brand of brands) {
        byId.set(brand.id, brand);
        const key = normalizeBrandKey(brand.name);
        const bucket = byKey.get(key);
        if (bucket) bucket.push(brand);
        else byKey.set(key, [brand]);
    }

    return { byId, byKey };
}

function failed(reason: BrandFailureReason): BrandOutcome {
    return { status: "failed", reason };
}

export function resolveBrandReference(index: BrandIndex, reference: BrandReference, policy: BrandPolicy): BrandOutcome {
    const hasId = reference.id !== null && reference.id !== undefined;
    const hasName = reference.name !== null && reference.name !== undefined;

    if (!hasId && !hasName) return failed(BRAND_FAILURE.required);

    const id = hasId ? checkBrandText(reference.id) : null;
    if (id && !id.ok) return failed(BRAND_FAILURE.invalidId);

    const name = hasName ? checkBrandText(reference.name) : null;
    if (name && !name.ok) return failed(BRAND_FAILURE.invalidName);

    if (id?.ok) {
        const byId = index.byId.get(id.value);
        if (!byId) return failed(BRAND_FAILURE.unknownId);
        if (name?.ok && normalizeBrandKey(name.value) !== normalizeBrandKey(byId.name)) return failed(BRAND_FAILURE.conflict);
        return { status: "resolved", brandId: byId.id };
    }

    // Exactly one of id/name is present, so by this point `name` is a valid name.
    const key = normalizeBrandKey((name as { ok: true; value: string }).value);
    const matches = index.byKey.get(key) ?? [];

    if (matches.length > 1) return failed(BRAND_FAILURE.ambiguous);
    if (matches.length === 1) return { status: "resolved", brandId: matches[0].id };
    if (policy === "require-existing") return failed(BRAND_FAILURE.unknownBrand);
    // A brand we would create must have a storable key (the database stores it, bounded).
    if (key.length > BRAND_KEY_MAX_LENGTH) return failed(BRAND_FAILURE.invalidName);

    return { status: "create", key, name: cleanBrandName((name as { ok: true; value: string }).value) };
}

export function planBrandResolution(brands: readonly BrandRecord[], references: readonly BrandReference[], policy: BrandPolicy): BrandPlan {
    const index = buildBrandIndex(brands);
    const outcomes = references.map((reference) => resolveBrandReference(index, reference, policy));

    // One display name per key. When spellings differ ("Nike" / "NIKE") the smallest string wins, so the result
    // never depends on the order of the rows in the file.
    const chosen = new Map<string, string>();
    for (const outcome of outcomes) {
        if (outcome.status !== "create") continue;
        const current = chosen.get(outcome.key);
        if (current === undefined || outcome.name < current) chosen.set(outcome.key, outcome.name);
    }

    const toCreate = [...chosen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, name]) => name);

    return { outcomes, toCreate };
}
