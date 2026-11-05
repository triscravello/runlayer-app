import { PrismaClient } from "@prisma/client";
import { describeErrorForLog } from "../lib/auth/logSafe";
import { auditBrands, auditExitCode, countPreferenceMentions, formatBrandAuditReport } from "../lib/ingestion/brandKeyAudit";

// READ-ONLY audit of brand identity, using the application's own key function (so, unlike the SQL census in
// prisma/maintenance/, its answers are exact for any Unicode). It reports:
//   - names the migration's ASCII-only SQL backfill cannot key (they need the JavaScript backfill). BEFORE the migration these
//     are blocking findings; AFTER it (when brands.normalized_name exists) they are informational only, because a valid
//     non-ASCII brand with the correct stored key is healthy,
//   - names the application would never accept,
//   - groups of brands that normalize to the same key, with gear counts and gear-name conflicts,
//   - how many user profiles list an affected brand (a count; no user is identified),
//   - after the migration: stored keys that differ from the key the application computes.
//
// It never writes: every statement runs inside a READ ONLY transaction and is a SELECT. It only runs against a database
// YOU name explicitly in BRAND_AUDIT_DATABASE_URL - it deliberately ignores DATABASE_URL - and it prints only
// host:port/database, never credentials.
//
//   BRAND_AUDIT_DATABASE_URL=... npx tsx scripts/brandKeyReport.ts
//
// Exit code: 0 clean, 2 blocking findings, 1 could not run. Blocking findings: invalid brand names, key-collision groups and
// stored keys that differ from the application's key always; names the ASCII backfill cannot key only before the migration.
const ENV_NAME = "BRAND_AUDIT_DATABASE_URL";

type BrandRowWithKey = { id: string; name: string; normalized_name: string | null };
type BrandRow = { id: string; name: string };

async function run(): Promise<number> {
    const raw = process.env[ENV_NAME]?.trim();
    if (!raw) {
        console.error(`${ENV_NAME} is not set. Point it at the database you want to audit (read-only).`);
        return 1;
    }

    let target: URL;
    try {
        target = new URL(raw);
    } catch {
        console.error(`${ENV_NAME} is not a valid URL.`);
        return 1;
    }
    if (target.protocol !== "postgresql:" && target.protocol !== "postgres:") {
        console.error(`${ENV_NAME} must be a PostgreSQL URL.`);
        return 1;
    }

    console.log(`Auditing ${target.hostname}:${target.port || "5432"}/${decodeURIComponent(target.pathname.replace(/^\//, ""))} (read-only)\n`);

    const client = new PrismaClient({ datasources: { db: { url: raw } } });
    try {
        const data = await client.$transaction(
            async (tx) => {
                await tx.$executeRaw`SET TRANSACTION READ ONLY`;

                const columns = await tx.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'brands'`;
                const hasKey = columns.some((column) => column.column_name === "normalized_name");

                const brands: Array<{ id: string; name: string; storedKey?: string | null }> = hasKey
                    ? (await tx.$queryRaw<BrandRowWithKey[]>`SELECT id, name, normalized_name FROM brands`).map((row) => ({ id: row.id, name: row.name, storedKey: row.normalized_name }))
                    : (await tx.$queryRaw<BrandRow[]>`SELECT id, name FROM brands`).map((row) => ({ id: row.id, name: row.name }));

                const gear = (await tx.$queryRaw<Array<{ brand_id: string; name: string }>>`SELECT brand_id, name FROM gear_items`).map((row) => ({ brandId: row.brand_id, name: row.name }));
                const profiles = await tx.$queryRaw<Array<{ preferred_brands: string[] | null; avoided_brands: string[] | null }>>`SELECT preferred_brands, avoided_brands FROM user_profiles`;

                return { brands, gear, hasKey, profiles };
            },
            { maxWait: 10_000, timeout: 60_000 },
        );

        const report = auditBrands(data.brands, data.gear, { keysStored: data.hasKey });
        // One combined list per profile, so a profile is counted once however many of its spellings it lists.
        const lists = data.profiles.map((profile) => [...(profile.preferred_brands ?? []), ...(profile.avoided_brands ?? [])]);

        console.log(`normalized_name column present: ${data.hasKey ? "yes" : "no (pre-migration database)"}\n`);
        console.log(formatBrandAuditReport(report, countPreferenceMentions(report, lists)));
        return auditExitCode(report);
    } finally {
        await client.$disconnect();
    }
}

run().then(
    (code) => process.exit(code),
    (error) => {
        console.error(`Brand audit failed: ${describeErrorForLog(error)}`);
        process.exit(1);
    },
);
