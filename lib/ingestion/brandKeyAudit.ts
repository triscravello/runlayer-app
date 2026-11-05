import { BRAND_KEY_MAX_LENGTH, normalizeBrandKey, toBrandIdentity } from "./brandResolution";

// Pure analysis for the read-only brand audit (scripts/brandKeyReport.ts). No database, no I/O: it takes rows that were
// already read and reports what a migration or remediation would have to deal with. Because it runs the application's
// own normalizeBrandKey, its answers are EXACT - unlike the SQL census in prisma/maintenance/, which can only approximate
// the key for non-ASCII names.

export type AuditBrand = { id: string; name: string; storedKey?: string | null };
export type AuditGearItem = { brandId: string; name: string };

export type UnsupportedReason = "not-ascii" | "control-character" | "blank" | "key-too-long";

const ASCII_CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Why the migration's SQL backfill cannot key this name exactly (empty = it can). These mirror guard 1 of the
 * 20261105200000_add_brand_normalized_name migration, one condition each:
 *   octet_length <> char_length   -> not-ascii
 *   ~ '[[:cntrl:]]'               -> control-character
 *   btrim(name) = ''              -> blank
 *   key longer than 100           -> key-too-long
 */
export function sqlBackfillProblems(name: string): UnsupportedReason[] {
    const problems: UnsupportedReason[] = [];
    if ([...name].some((character) => (character.codePointAt(0) ?? 0) > 0x7f)) problems.push("not-ascii");
    if (ASCII_CONTROL.test(name)) problems.push("control-character");
    if (name.replace(/^ +| +$/g, "") === "") problems.push("blank");
    if (name.replace(/^ +| +$/g, "").replace(/ +/g, " ").length > BRAND_KEY_MAX_LENGTH) problems.push("key-too-long");
    return problems;
}

/**
 * The key the migration's SQL computes for a supported name, written in JavaScript:
 *   translate(regexp_replace(btrim(name), ' +', ' ', 'g'), 'A-Z', 'a-z')
 * btrim trims only spaces, ' +' collapses runs of spaces, translate lowercases A-Z and nothing else (no locale). Returns
 * null for names the SQL refuses. For every such supported name this MUST equal normalizeBrandKey(name); the tests prove
 * it over an exhaustive and a seeded corpus.
 */
export function sqlBackfillKey(name: string): string | null {
    if (sqlBackfillProblems(name).length > 0) return null;
    return name
        .replace(/^ +| +$/g, "")
        .replace(/ +/g, " ")
        .replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

export type AuditGroupBrand = { id: string; name: string; gearCount: number };

/**
 * Which side of the brand-key migration the database is on.
 *  - "pre-migration":  brands.normalized_name does not exist yet. A name the ASCII-only SQL backfill cannot key is a
 *    BLOCKING finding: the migration would refuse it.
 *  - "post-migration": the column exists. The backfill is history, so such a name is INFORMATIONAL (it is a perfectly valid
 *    brand when its stored key is right), and what matters is that every stored key equals the key the application computes.
 */
export type AuditMode = "pre-migration" | "post-migration";

export type AuditOptions = {
    /**
     * True when brands.normalized_name exists (post-migration), false when it does not. When omitted it is inferred: the
     * database counts as post-migration if any brand carries a stored key. Passing it explicitly (as the audit script does)
     * is stricter: a brand with NO stored key is then reported as a mismatch instead of being skipped.
     */
    keysStored?: boolean;
};

export type BrandAuditReport = {
    mode: AuditMode;
    total: number;
    /**
     * Names the ASCII SQL backfill cannot key. BLOCKING before the migration (they need the JavaScript backfill);
     * informational after it (never counted in `findings`).
     */
    unsupportedForSqlBackfill: Array<{ id: string; name: string; reasons: UnsupportedReason[] }>;
    /** Names the application itself would never accept as a brand (blank, control characters, over-long, or an over-long key). */
    invalidBrandNames: Array<{ id: string; name: string }>;
    /** Brands whose application key is identical. `gearNameConflicts` are gear names present under more than one brand of the group. */
    collisionGroups: Array<{ key: string; brands: AuditGroupBrand[]; gearNameConflicts: string[] }>;
    /** Only when stored keys were supplied: a stored key that differs from the one the application computes. */
    storedKeyMismatches: Array<{ id: string; name: string; storedKey: string | null; expectedKey: string }>;
    /**
     * Number of BLOCKING problems; zero means a clean audit. Invalid names, key-collision groups and stored-key mismatches
     * always block. Unsupported-for-SQL-backfill names block only before the migration.
     */
    findings: number;
};

/** Process exit code for a report: 0 when clean, 2 when there is at least one blocking finding. */
export function auditExitCode(report: BrandAuditReport): 0 | 2 {
    return report.findings === 0 ? 0 : 2;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function auditBrands(brands: readonly AuditBrand[], gearItems: readonly AuditGearItem[] = [], options: AuditOptions = {}): BrandAuditReport {
    const mode: AuditMode = (options.keysStored ?? brands.some((brand) => brand.storedKey !== undefined)) ? "post-migration" : "pre-migration";

    const gearByBrand = new Map<string, string[]>();
    for (const item of gearItems) {
        const names = gearByBrand.get(item.brandId);
        if (names) names.push(item.name);
        else gearByBrand.set(item.brandId, [item.name]);
    }

    const ordered = [...brands].sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id));

    const unsupportedForSqlBackfill = ordered.flatMap((brand) => {
        const reasons = sqlBackfillProblems(brand.name);
        return reasons.length ? [{ id: brand.id, name: brand.name, reasons }] : [];
    });

    const invalidBrandNames = ordered.filter((brand) => toBrandIdentity(brand.name) === null).map((brand) => ({ id: brand.id, name: brand.name }));

    const groups = new Map<string, AuditBrand[]>();
    for (const brand of ordered) {
        const key = normalizeBrandKey(brand.name);
        const members = groups.get(key);
        if (members) members.push(brand);
        else groups.set(key, [brand]);
    }

    const collisionGroups = [...groups.entries()]
        .filter(([, members]) => members.length > 1)
        .sort(([a], [b]) => byText(a, b))
        .map(([key, members]) => {
            const owners = new Map<string, Set<string>>();
            for (const member of members) {
                for (const gearName of gearByBrand.get(member.id) ?? []) {
                    const set = owners.get(gearName);
                    if (set) set.add(member.id);
                    else owners.set(gearName, new Set([member.id]));
                }
            }

            return {
                key,
                brands: members.map((member) => ({ id: member.id, name: member.name, gearCount: gearByBrand.get(member.id)?.length ?? 0 })),
                gearNameConflicts: [...owners.entries()].filter(([, ids]) => ids.size > 1).map(([gearName]) => gearName).sort(byText),
            };
        });

    // Every stored key is checked against the AUTHORITATIVE key: the application's own normalizeBrandKey (never a SQL guess).
    const storedKeyMismatches = ordered.flatMap((brand) => {
        const storedKey = brand.storedKey === undefined ? (options.keysStored === true ? null : undefined) : brand.storedKey;
        if (storedKey === undefined) return [];
        const expectedKey = normalizeBrandKey(brand.name);
        return storedKey === expectedKey ? [] : [{ id: brand.id, name: brand.name, storedKey, expectedKey }];
    });

    const blockingUnsupported = mode === "pre-migration" ? unsupportedForSqlBackfill.length : 0;

    return {
        mode,
        total: brands.length,
        unsupportedForSqlBackfill,
        invalidBrandNames,
        collisionGroups,
        storedKeyMismatches,
        findings: blockingUnsupported + invalidBrandNames.length + collisionGroups.length + storedKeyMismatches.length,
    };
}

/**
 * For each collision group, how many user profiles list the brand (any of its spellings) as a preferred or avoided brand.
 * Preferences store brand NAMES, not ids, so they are the dependent data a merge could affect. Counts only: no user
 * identifiers are read or reported.
 */
export function countPreferenceMentions(report: BrandAuditReport, preferenceLists: ReadonlyArray<ReadonlyArray<string>>): Array<{ key: string; profiles: number }> {
    return report.collisionGroups.map((group) => {
        const spellings = new Set(group.brands.map((brand) => brand.name.trim().toLowerCase()));
        const profiles = preferenceLists.filter((list) => list.some((entry) => normalizeBrandKey(entry) === group.key || spellings.has(entry.trim().toLowerCase()))).length;
        return { key: group.key, profiles };
    });
}

/**
 * Plain-text rendering of a report. Names are printed quoted, with every non-printable-ASCII character shown as a \\u escape
 * so that invisible characters (zero-width spaces, no-break spaces, tabs) are visible. It prints brand names, ids and counts only: never a connection string,
 * and never anything about an individual user.
 */
export function formatBrandAuditReport(report: BrandAuditReport, preferenceMentions: ReadonlyArray<{ key: string; profiles: number }> = []): string {
    const lines: string[] = [];
    // Every character outside printable ASCII is printed as an escape, so a zero-width space, a no-break space or a
    // full-width letter cannot hide inside a name that looks ordinary.
    const show = (name: string) =>
        `"${[...name]
            .map((character) => {
                const codePoint = character.codePointAt(0) as number;
                if (character === '"' || character === "\\") return `\\${character}`;
                if (codePoint >= 0x20 && codePoint <= 0x7e) return character;
                return codePoint > 0xffff ? `\\u{${codePoint.toString(16)}}` : `\\u${codePoint.toString(16).padStart(4, "0")}`;
            })
            .join("")}"`;

    lines.push(`Brands audited: ${report.total}`);
    lines.push(`Database state: ${report.mode}`);
    lines.push(`Findings: ${report.findings}${report.findings === 0 ? " (clean)" : ""}`);

    lines.push(
        "",
        report.mode === "pre-migration"
            ? `Names the SQL backfill cannot key exactly (need the JavaScript backfill): ${report.unsupportedForSqlBackfill.length}`
            : `Names the historical ASCII SQL backfill could not key (informational after the migration; valid when the stored key is correct): ${report.unsupportedForSqlBackfill.length}`,
    );
    for (const entry of report.unsupportedForSqlBackfill) lines.push(`  ${entry.id}  ${show(entry.name)}  [${entry.reasons.join(", ")}]`);

    lines.push("", `Names the application would never accept as a brand: ${report.invalidBrandNames.length}`);
    for (const entry of report.invalidBrandNames) lines.push(`  ${entry.id}  ${show(entry.name)}`);

    lines.push("", `Groups of brands that share one normalized key: ${report.collisionGroups.length}`);
    for (const group of report.collisionGroups) {
        const profiles = preferenceMentions.find((mention) => mention.key === group.key)?.profiles;
        lines.push(`  key ${show(group.key)}${profiles === undefined ? "" : `  (profiles listing it as preferred/avoided: ${profiles})`}`);
        for (const member of group.brands) lines.push(`    ${member.id}  ${show(member.name)}  gear items: ${member.gearCount}`);
        lines.push(`    gear names present under more than one of these brands (block an automatic merge): ${group.gearNameConflicts.length ? group.gearNameConflicts.map(show).join(", ") : "none"}`);
    }

    lines.push("", `Stored keys that differ from the key the application computes: ${report.storedKeyMismatches.length}`);
    for (const entry of report.storedKeyMismatches) lines.push(`  ${entry.id}  ${show(entry.name)}  stored ${show(String(entry.storedKey))}  expected ${show(entry.expectedKey)}`);

    return lines.join("\n");
}
