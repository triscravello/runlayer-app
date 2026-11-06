// The versioned preflight evidence report, and the checks the guarded migration command applies to it.
//
// WHAT THIS IS. A record, collected read-only, of what a target database looked like at one moment, bound to the target
// and to the exact migration set in this repository.
//
// WHAT THIS IS NOT. Authorization. A report never permits a change by itself: the guarded command still needs the operator's
// explicit target, allowlist entry and typed confirmation, and it only accepts a report as one more necessary condition.
//
// LIMITS (also stated in docs/first-deployment-runbook.md):
//  - Time of check / time of use. The database can change after the report was collected. Freshness bounds the window; it
//    does not close it. The operator reconfirms the target at execution time, and the migrations' own guards still run
//    inside the migration transaction.
//  - The digest detects accidental damage and hand edits. It is NOT a signature: anyone who can write the file can recompute
//    it. The report is evidence for a careful operator, not a security boundary against a hostile one.
//
// The report holds no credentials and no personal data: identifiers are opaque brand ids and counts only.

import { createHash } from "node:crypto";
import { z } from "zod";
import type { DatabaseTarget } from "./databaseTarget";
import type { MigrationSet } from "./migrationFingerprint";

export const REPORT_VERSION = 1;
export const TOOL_NAME = "runlayer-preflight";
export const TOOL_VERSION = "1.0.0";

/** Schema states a migration may proceed from. Everything else needs a person to resolve it first. */
export const MIGRATABLE_STATES = ["empty", "behind", "current"] as const;

export const SCHEMA_STATES = ["empty", "untracked", "behind", "current", "failed_migration", "diverged", "drift"] as const;
export type SchemaState = (typeof SCHEMA_STATES)[number];

const count = z.number().int().min(0);
const auditStatus = z.enum(["complete", "not_applicable"]);

export const findingSchema = z
    .object({
        code: z.string().regex(/^[a-z0-9_]{1,64}$/),
        severity: z.enum(["blocking", "warning", "info"]),
        message: z.string().max(300),
        count: count.optional(),
        /** Opaque identifiers only (brand ids, migration names). Never names, e-mail addresses or free text. */
        ids: z.array(z.string().max(80)).max(50).optional(),
    })
    .strict();
export type Finding = z.infer<typeof findingSchema>;

export const reportBodySchema = z
    .object({
        reportVersion: z.literal(REPORT_VERSION),
        tool: z.object({ name: z.literal(TOOL_NAME), version: z.string().max(32) }).strict(),
        collectedAt: z.string().max(40),
        target: z
            .object({
                key: z.string().max(300),
                database: z.string().max(63),
                serverVersion: z.string().max(64),
                inRecovery: z.boolean(),
                identityVerified: z.boolean(),
                readOnlyTransaction: z.boolean(),
            })
            .strict(),
        role: z.object({ superuser: z.boolean(), canCreate: z.boolean(), canWrite: z.boolean() }).strict(),
        migrationSet: z.object({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/), count: count, names: z.array(z.string().max(120)).max(500) }).strict(),
        schema: z
            .object({
                state: z.enum(SCHEMA_STATES),
                hasMigrationHistory: z.boolean(),
                tablesPresent: z.array(z.string().max(64)).max(20),
                applied: z.array(z.string().max(120)).max(500),
                pending: z.array(z.string().max(120)).max(500),
                failed: z.array(z.string().max(120)).max(500),
                unknownApplied: z.array(z.string().max(120)).max(500),
                checksumMismatches: z.array(z.string().max(120)).max(500),
            })
            .strict(),
        audits: z
            .object({
                outfitItems: z.object({ status: auditStatus, duplicateGroups: count, removableRows: count, uniqueIndexPresent: z.boolean() }).strict(),
                brands: z
                    .object({
                        status: auditStatus,
                        mode: z.enum(["pre-migration", "post-migration"]).nullable(),
                        total: count,
                        unsupportedForSqlBackfill: count,
                        invalidNames: count,
                        collisionGroups: count,
                        gearNameConflicts: count,
                        storedKeyMismatches: count,
                        profilesListingAffected: count,
                    })
                    .strict(),
                sessions: z.object({ status: auditStatus, columnPresent: z.boolean(), users: count }).strict(),
            })
            .strict(),
        rowCounts: z.record(z.string().max(64), count),
        findings: z.array(findingSchema).max(100),
        verification: z.object({ status: z.enum(["pass", "fail"]), blockingFindings: count }).strict(),
    })
    .strict();

export type PreflightReportBody = z.infer<typeof reportBodySchema>;

export const reportSchema = reportBodySchema.extend({ reportDigest: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export type PreflightReport = z.infer<typeof reportSchema>;

/** JSON with object keys sorted at every level, so the digest does not depend on key order. */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

export function digestOf(body: PreflightReportBody): string {
    return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

export function sealReport(body: PreflightReportBody): PreflightReport {
    return { ...body, reportDigest: digestOf(body) };
}

/** A person-readable one-per-line summary of the blocking and warning findings. Fixed vocabulary; no secrets. */
export function summarizeFindings(report: PreflightReportBody): string[] {
    return report.findings
        .filter((finding) => finding.severity !== "info")
        .map((finding) => `[${finding.severity}] ${finding.code}${finding.count !== undefined ? ` (${finding.count})` : ""}: ${finding.message}`);
}

export const DEFAULT_MAX_EVIDENCE_AGE_MINUTES = 30;
export const MAX_ALLOWED_EVIDENCE_AGE_MINUTES = 240;
const FUTURE_SKEW_MS = 2 * 60 * 1000;

export type EvidenceCheck = {
    target: DatabaseTarget;
    migrationSet: MigrationSet;
    now: Date;
    maxAgeMinutes?: number;
};

export type EvidenceSummary = {
    collectedAt: string;
    ageMinutes: number;
    schemaState: SchemaState;
    pending: string[];
    warnings: string[];
};

export type EvidenceVerdict = { ok: true; summary: EvidenceSummary } | { ok: false; reasons: string[] };

/**
 * Decides whether a parsed JSON value is acceptable evidence for migrating `check.target` with `check.migrationSet`,
 * right now. Returns EVERY reason it is not (fixed strings only), so an operator can fix them in one pass.
 */
export function evaluateEvidence(input: unknown, check: EvidenceCheck): EvidenceVerdict {
    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reasons: ["The evidence file is not a valid preflight report (unknown version, missing field or unexpected field)."] };

    const report = parsed.data;
    const reasons: string[] = [];
    const { reportDigest, ...body } = report;

    if (reportDigest !== digestOf(body)) reasons.push("The evidence digest does not match its content (the file was edited or damaged).");

    if (report.target.key !== check.target.key) reasons.push("The evidence was collected for a different target.");
    if (!report.target.identityVerified) reasons.push("The evidence does not record a verified target identity.");
    if (!report.target.readOnlyTransaction) reasons.push("The evidence does not record a read-only collection.");
    if (report.target.database !== check.target.database) reasons.push("The evidence records a different database name.");
    if (report.target.inRecovery) reasons.push("The evidence was collected from a server in recovery (a replica).");

    if (report.migrationSet.fingerprint !== check.migrationSet.fingerprint) reasons.push("The evidence was collected for a different migration set than the one in this repository.");
    if (report.migrationSet.count !== check.migrationSet.migrations.length) reasons.push("The evidence records a different number of migrations.");

    const collectedAt = Date.parse(report.collectedAt);
    let ageMinutes = Number.NaN;
    if (!Number.isFinite(collectedAt)) {
        reasons.push("The evidence has no valid collection time.");
    } else {
        const maxMinutes = Math.min(Math.max(check.maxAgeMinutes ?? DEFAULT_MAX_EVIDENCE_AGE_MINUTES, 1), MAX_ALLOWED_EVIDENCE_AGE_MINUTES);
        const ageMs = check.now.getTime() - collectedAt;
        ageMinutes = Math.round(ageMs / 60000);
        if (ageMs < -FUTURE_SKEW_MS) reasons.push("The evidence is dated in the future.");
        else if (ageMs > maxMinutes * 60000) reasons.push(`The evidence is older than ${maxMinutes} minutes; collect it again.`);
    }

    const blocking = report.findings.filter((finding) => finding.severity === "blocking").length;
    if (report.verification.status !== "pass") reasons.push("The preflight did not pass.");
    if (blocking > 0 || report.verification.blockingFindings > 0) reasons.push("The evidence contains blocking findings.");
    if (blocking !== report.verification.blockingFindings) reasons.push("The evidence is internally inconsistent (finding counts disagree).");

    if (!(MIGRATABLE_STATES as readonly string[]).includes(report.schema.state)) reasons.push(`The schema state "${report.schema.state}" cannot be migrated until a person resolves it.`);
    if (report.schema.failed.length > 0) reasons.push("The evidence records an unresolved failed migration.");

    const known = new Set(check.migrationSet.migrations.map((migration) => migration.name));
    if (report.schema.pending.some((name) => !known.has(name))) reasons.push("The evidence lists a pending migration that does not exist in this repository.");

    // Coverage: an audit may only be "not applicable" for a table the database does not have.
    const present = new Set(report.schema.tablesPresent);
    const coverage: Array<[string, "complete" | "not_applicable"]> = [
        ["outfit_items", report.audits.outfitItems.status],
        ["brands", report.audits.brands.status],
        ["users", report.audits.sessions.status],
    ];
    for (const [table, status] of coverage) {
        if (present.has(table) && status !== "complete") reasons.push("An audit that should have run was skipped.");
    }

    if (reasons.length > 0) return { ok: false, reasons: [...new Set(reasons)] };

    return {
        ok: true,
        summary: {
            collectedAt: report.collectedAt,
            ageMinutes,
            schemaState: report.schema.state,
            pending: report.schema.pending,
            warnings: report.findings.filter((finding) => finding.severity === "warning").map((finding) => finding.code),
        },
    };
}
