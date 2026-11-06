import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { MigrationSetError, readMigrationSet } from "../lib/deploy/migrationFingerprint";
import { EXECUTE_SCRIPT_NAME, buildPrismaInvocation, evaluateGuard } from "../lib/deploy/migrationGuard";

// Guarded replacement for `prisma migrate deploy`.
//
//   npm run db:deploy -- --evidence <report.json>            CHECK ONLY: runs every guard, then stops. Never migrates.
//   npm run db:deploy:execute -- --evidence <report.json>    The separately authorized path: same guards, then runs Prisma.
//
// It needs, all supplied explicitly in the shell (never read from .env, never from DATABASE_URL):
//   RUNLAYER_MIGRATE_TARGET_URL     the connection URL to migrate
//   RUNLAYER_DB_ALLOWED_TARGETS     exact host:port/database entries the operator has approved
//   RUNLAYER_MIGRATE_CONFIRM_TARGET the target's host:port/database, typed again
//   --evidence <file>               a passing, fresh report from `npm run db:preflight` for the same target and migrations
//
// Exit codes: 0 = guards passed (check) or Prisma succeeded; 3 = refused by a guard; 1 = could not run; any other value is
// Prisma's own exit status, passed through unchanged.
//
// It does not prevent running `npx prisma migrate deploy` directly. See docs/first-deployment-runbook.md, "Bypass paths".
const EXIT_REFUSED = 3;
const MAX_EVIDENCE_BYTES = 1_000_000;

function readEvidenceFile(filePath: string): string {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size > MAX_EVIDENCE_BYTES) throw new Error("unreadable");
    return readFileSync(filePath, "utf8");
}

function main(): number {
    const cwd = process.cwd();
    if (!existsSync(path.join(cwd, "prisma", "schema.prisma")) || !existsSync(path.join(cwd, "prisma", "migrations"))) {
        console.error("Run this from the repository root (prisma/schema.prisma and prisma/migrations were not found).");
        return 1;
    }

    let migrationSet;
    try {
        migrationSet = readMigrationSet(path.join(cwd, "prisma", "migrations"));
    } catch (error) {
        console.error(error instanceof MigrationSetError ? error.message : "The migrations could not be read.");
        return 1;
    }

    const decision = evaluateGuard({ env: process.env, argv: process.argv.slice(2), now: new Date(), migrationSet, readEvidence: readEvidenceFile });
    if (!decision.ok) {
        console.error(`REFUSED at the ${decision.stage} check. Nothing was run.`);
        for (const reason of decision.reasons) console.error(`  - ${reason}`);
        return EXIT_REFUSED;
    }

    const { target, summary } = decision;
    console.log(`Target:            ${target.key}`);
    console.log(`Schema state:      ${summary.schemaState}`);
    console.log(`Pending:           ${summary.pending.length ? summary.pending.join(", ") : "(none)"}`);
    console.log(`Evidence:          collected ${summary.collectedAt} (${summary.ageMinutes} minute(s) ago)`);
    console.log(`Migration set:     ${migrationSet.fingerprint.slice(0, 16)}… (${migrationSet.migrations.length} migrations)`);
    if (summary.warnings.length) console.log(`Warnings:          ${summary.warnings.join(", ")}`);
    console.log("Note: the evidence is a snapshot. The database may have changed since it was collected; you have just re-confirmed the target.");

    if (!decision.execute) {
        console.log(`\nAll guards passed. NOTHING WAS EXECUTED. To apply the migrations, run "npm run ${EXECUTE_SCRIPT_NAME}" with the same inputs, once that step is authorized.`);
        return 0;
    }

    const invocation = buildPrismaInvocation({ target, cwd, nodeExecutable: process.execPath, parentEnv: process.env });
    if (!existsSync(invocation.args[0])) {
        console.error("The installed Prisma CLI was not found under node_modules. Nothing was run.");
        return 1;
    }

    console.log(`\nRunning "prisma migrate deploy" against ${target.key} (Prisma's own output follows).\n`);
    // The environment is built from scratch on purpose, so it carries no NODE_ENV; Next's global typings make that field
    // mandatory on NodeJS.ProcessEnv, hence the cast. Prisma does not need it.
    const result = spawnSync(invocation.command, invocation.args, { cwd: invocation.cwd, env: invocation.env as unknown as NodeJS.ProcessEnv, stdio: "inherit" });

    if (result.error) {
        console.error("Prisma could not be started.");
        return 1;
    }
    return result.status ?? 1;
}

process.exit(main());
