// The decision logic of the guarded migration command (scripts/migrateGuarded.ts). Pure: it receives the environment, the
// arguments, the clock and a way to read the evidence file as parameters, and it returns a decision. It starts no process,
// opens no connection and reads neither process.env nor DATABASE_URL.
//
// A passing decision does not run anything. Only `--execute`, invoked through the separately named npm script, lets the
// entry point start Prisma, and only after every guard below has passed.
//
// WHAT THIS DOES NOT PREVENT. Anyone can still run `npx prisma migrate deploy` directly with whatever DATABASE_URL their
// shell or .env supplies. This wrapper is a guard rail for the sanctioned path, not a security boundary. See
// docs/first-deployment-runbook.md ("Bypass paths"): keep production credentials out of the ordinary development
// environment and out of .env.

import path from "node:path";
import { TargetError, assertTargetAllowed, assertTargetConfirmed, parseDatabaseTarget, parseTargetAllowlist, type DatabaseTarget } from "./databaseTarget";
import type { MigrationSet } from "./migrationFingerprint";
import { DEFAULT_MAX_EVIDENCE_AGE_MINUTES, MAX_ALLOWED_EVIDENCE_AGE_MINUTES, evaluateEvidence, type EvidenceSummary } from "./preflightReport";

export type GuardEnv = Readonly<Record<string, string | undefined>>;

/** The only environment variables the guard consults. DATABASE_URL is deliberately not among them. */
export const GUARD_ENV = {
    target: "RUNLAYER_MIGRATE_TARGET_URL",
    allowlist: "RUNLAYER_DB_ALLOWED_TARGETS",
    confirm: "RUNLAYER_MIGRATE_CONFIRM_TARGET",
    maxAgeMinutes: "RUNLAYER_MIGRATE_EVIDENCE_MAX_AGE_MINUTES",
} as const;

/** The npm script that is allowed to pass --execute. */
export const EXECUTE_SCRIPT_NAME = "db:deploy:execute";

export type GuardArgs = { evidencePath: string | null; execute: boolean };

export type ArgsResult = { ok: true; args: GuardArgs } | { ok: false; reason: string };

/** Accepts exactly `--execute` and `--evidence <path>` (or `--evidence=<path>`). Anything else is refused, so nothing is ever forwarded to Prisma. */
export function parseGuardArgs(argv: readonly string[]): ArgsResult {
    let evidencePath: string | null = null;
    let execute = false;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === "--execute") {
            if (execute) return { ok: false, reason: "--execute was given more than once." };
            execute = true;
        } else if (arg === "--evidence" || arg.startsWith("--evidence=")) {
            if (evidencePath !== null) return { ok: false, reason: "--evidence was given more than once." };
            const value = arg === "--evidence" ? argv[++index] : arg.slice("--evidence=".length);
            if (!value || value.startsWith("--")) return { ok: false, reason: "--evidence needs a file path." };
            evidencePath = value;
        } else {
            return { ok: false, reason: "Unknown argument. Only --evidence <file> and --execute are accepted; nothing is forwarded to Prisma." };
        }
    }

    return { ok: true, args: { evidencePath, execute } };
}

export type GuardInputs = {
    env: GuardEnv;
    argv: readonly string[];
    now: Date;
    migrationSet: MigrationSet;
    /** Returns the evidence file's text. May throw; the guard reports a fixed message instead of the error. */
    readEvidence: (filePath: string) => string;
};

export type GuardStage = "arguments" | "target" | "allowlist" | "confirmation" | "evidence" | "lifecycle";

export type GuardDecision =
    | { ok: false; stage: GuardStage; reasons: string[] }
    | { ok: true; target: DatabaseTarget; execute: boolean; summary: EvidenceSummary };

const fail = (stage: GuardStage, ...reasons: string[]): GuardDecision => ({ ok: false, stage, reasons });

function parseMaxAge(raw: string | undefined): number | null | "invalid" {
    if (raw === undefined || raw.trim() === "") return null;
    if (!/^\d{1,4}$/.test(raw.trim())) return "invalid";
    const minutes = Number(raw.trim());
    return minutes >= 1 && minutes <= MAX_ALLOWED_EVIDENCE_AGE_MINUTES ? minutes : "invalid";
}

/** Runs every guard in order and stops at the first stage that fails. */
export function evaluateGuard(inputs: GuardInputs): GuardDecision {
    const parsedArgs = parseGuardArgs(inputs.argv);
    if (!parsedArgs.ok) return fail("arguments", parsedArgs.reason);
    const { args } = parsedArgs;

    if (!args.evidencePath) return fail("arguments", "--evidence <file> is required: pass the report produced by the read-only preflight.");

    const maxAge = parseMaxAge(inputs.env[GUARD_ENV.maxAgeMinutes]);
    if (maxAge === "invalid") return fail("arguments", `${GUARD_ENV.maxAgeMinutes} must be a whole number of minutes from 1 to ${MAX_ALLOWED_EVIDENCE_AGE_MINUTES}.`);

    // 1. Target: explicit, strict, and never taken from DATABASE_URL.
    let target: DatabaseTarget;
    try {
        target = parseDatabaseTarget(inputs.env[GUARD_ENV.target]);
    } catch (error) {
        if (error instanceof TargetError) {
            const hint = error.code === "missing" ? ` Set ${GUARD_ENV.target}; DATABASE_URL is deliberately ignored.` : "";
            return fail("target", `${error.message}${hint}`);
        }
        throw error;
    }

    // 2. Allowlist: exact entries supplied by the operator.
    try {
        assertTargetAllowed(target, parseTargetAllowlist(inputs.env[GUARD_ENV.allowlist]));
    } catch (error) {
        if (error instanceof TargetError) return fail("allowlist", `${error.message} (${GUARD_ENV.allowlist}, exact host:port/database entries)`);
        throw error;
    }

    // 3. Confirmation: the operator types the full target.
    try {
        assertTargetConfirmed(target, inputs.env[GUARD_ENV.confirm]);
    } catch (error) {
        if (error instanceof TargetError) return fail("confirmation", `${error.message} (${GUARD_ENV.confirm} must equal the target's host:port/database)`);
        throw error;
    }

    // 4. Evidence: present, well formed, fresh, passing, and bound to this target and this migration set.
    let text: string;
    try {
        text = inputs.readEvidence(args.evidencePath);
    } catch {
        return fail("evidence", "The evidence file could not be read.");
    }

    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return fail("evidence", "The evidence file is not valid JSON.");
    }

    const verdict = evaluateEvidence(json, { target, migrationSet: inputs.migrationSet, now: inputs.now, maxAgeMinutes: maxAge ?? DEFAULT_MAX_EVIDENCE_AGE_MINUTES });
    if (!verdict.ok) return { ok: false, stage: "evidence", reasons: verdict.reasons };

    // 5. Execution is only for the dedicated npm script (or a direct invocation, where npm sets no lifecycle event).
    if (args.execute) {
        const lifecycle = inputs.env.npm_lifecycle_event;
        if (lifecycle !== undefined && lifecycle !== EXECUTE_SCRIPT_NAME) {
            return fail("lifecycle", `--execute is not permitted from the npm "${lifecycle.slice(0, 40)}" lifecycle; use "npm run ${EXECUTE_SCRIPT_NAME}".`);
        }
    }

    return { ok: true, target, execute: args.execute, summary: verdict.summary };
}

// ---------------------------------------------------------------------------------------------------------------------

/** Variables copied from the parent process into Prisma's environment. Nothing else is inherited. */
export const CHILD_ENV_PASSTHROUGH = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TERM", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "SYSTEMROOT"] as const;

export type PrismaInvocation = {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
};

/**
 * The exact process to start for `prisma migrate deploy`. Design points:
 *  - Prisma is run with the installed copy under node_modules (never `npx`, which may download a different version).
 *  - Its environment is built from scratch: a short pass-through list plus DATABASE_URL set to the approved target. Because
 *    Prisma's own .env loading never overrides a variable that is already set, an ordinary .env cannot redirect it, and no
 *    DIRECT_URL, SHADOW_DATABASE_URL or PRISMA_* override from the parent reaches it.
 *  - The arguments are fixed. Nothing the operator typed is forwarded.
 */
export function buildPrismaInvocation(input: { target: DatabaseTarget; cwd: string; nodeExecutable: string; parentEnv: GuardEnv }): PrismaInvocation {
    const env: Record<string, string> = {};
    for (const name of CHILD_ENV_PASSTHROUGH) {
        const value = input.parentEnv[name];
        if (value !== undefined) env[name] = value;
    }
    env.DATABASE_URL = input.target.url;
    env.CHECKPOINT_DISABLE = "1";
    env.PRISMA_HIDE_UPDATE_MESSAGE = "1";

    return {
        command: input.nodeExecutable,
        args: [path.join(input.cwd, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy", "--schema", path.join(input.cwd, "prisma", "schema.prisma")],
        env,
        cwd: input.cwd,
    };
}
