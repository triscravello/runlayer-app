// The strict command ORDER of the disposable-database wrapper, with every side effect injected (see scripts/migrateDisposable.ts for the
// real ones). Because the effects are parameters, the ordering and failure propagation can be tested offline with fakes.
//
//   1 target          parse and restrict the URL                      \
//   2 data_directory  validate the expected data directory             |  pure, no I/O
//   3 prisma_version  the Prisma CLI must be the audited 5.22.x        /
//   4 port_owner      the one process on the port is the expected postgres (lsof + postmaster.pid; never `ps`, which a sandbox cannot run)
//   5 identity        the server reports the expected database, port, address, data directory and contents (read-only session)
//   6 prisma_status   `prisma migrate status` states the SAME target, and nothing unexpected
//   7 migrate         `prisma migrate deploy` with the byte-identical environment (only with execute: true)
//
// A stage that fails, or throws, stops everything after it. Nothing is retried, and no later stage "confirms" an earlier one.

import type { DatabaseTarget } from "../deploy/databaseTarget";
import type { GuardEnv } from "../deploy/migrationGuard";
import {
    DisposableError, buildDisposableInvocations, evaluatePrismaStatus, extractKnownTables, parseDisposableTarget, parseLsofCwd, parseLsofListeners, parsePostmasterPid,
    readEnvKeyNames, sameEffectiveConfiguration, validateDataDirectory, validateDatabaseIdentity, validatePortOwner, validatePrismaVersion,
    type CommandOutcome, type DisposableInvocation, type IdentityFacts, type Listener, type Verdict,
} from "./disposableTarget";

export type DisposableStage = "target" | "data_directory" | "prisma_version" | "port_owner" | "identity" | "prisma_status" | "migrate";

export type DisposableConfig = { url: string | undefined; dataDirectory: string | undefined; allowedRoot: string | undefined; execute: boolean };

export type PrismaRun = { status: number | null; output: string; started: boolean };

export type DisposableDeps = {
    cwd: string;
    nodeExecutable: string;
    parentEnv: GuardEnv;
    readPrismaVersion: () => string | null;
    /** The text of every dotenv file Prisma would load (their NAMES are read, never their values). */
    readDotenvTexts: () => string[];
    readSchemaText: () => string;
    /** The real path of a directory, or null if it does not exist. */
    realpathDirectory: (directory: string) => string | null;
    /** `lsof -F pcfn` for the TCP listeners on the port, already classified. Must not use a shell or `ps`. */
    listListeners: (port: number) => CommandOutcome;
    /** `lsof -F pfn -d cwd` for one pid, already classified. */
    readProcessCwd: (pid: number) => CommandOutcome;
    /** The text of `<data directory>/postmaster.pid`, or null when the file does not exist. Throws on any other failure. */
    readPostmasterPid: (dataDirectory: string) => string | null;
    queryIdentityFacts: (target: DatabaseTarget) => Promise<IdentityFacts>;
    runPrisma: (invocation: DisposableInvocation) => PrismaRun;
};

export type DisposableResult =
    | { ok: true; mode: "check" | "migrate"; completed: DisposableStage[]; prismaState: "up_to_date" | "pending" }
    | { ok: false; stage: DisposableStage; reasons: string[]; completed: DisposableStage[] };

type Failed = { ok: false; reasons: string[] };
const UNAVAILABLE: Failed = Object.freeze({ ok: false, reasons: Object.freeze(["port_inspection_unavailable"]) as unknown as string[] });

function readListeners(deps: DisposableDeps, port: number): { ok: true; listeners: Listener[] } | { ok: false; reasons: string[] } {
    const outcome = deps.listListeners(port);
    if (outcome.kind === "none") return { ok: false, reasons: ["port_not_listening"] };
    if (outcome.kind !== "ok") return UNAVAILABLE;
    const listeners = parseLsofListeners(outcome.stdout);
    return listeners === null ? UNAVAILABLE : { ok: true, listeners };
}

/**
 * Establishes who listens on the target port WITHOUT `ps`: the listeners (lsof), the single owner's current directory (lsof), the expected
 * directory's postmaster.pid, and the listeners again. Every unavailable, malformed or throwing observation is port_inspection_unavailable.
 */
export function verifyPortOwner(deps: DisposableDeps, target: DatabaseTarget, expectedDirectory: string): Verdict {
    try {
        const first = readListeners(deps, target.port);
        if (!first.ok) return first;
        if (first.listeners.length !== 1) return validatePortOwner(target, expectedDirectory, { listeners: first.listeners, cwd: null, postmasterPid: null, relisted: first.listeners });
        const owner = first.listeners[0] as Listener;

        const cwdOutcome = deps.readProcessCwd(owner.pid);
        if (cwdOutcome.kind === "none") return { ok: false, reasons: ["port_owner_changed"] };
        if (cwdOutcome.kind !== "ok") return UNAVAILABLE;
        const cwd = parseLsofCwd(cwdOutcome.stdout, owner.pid);
        if (cwd === null) return UNAVAILABLE;

        const pidFile = deps.readPostmasterPid(expectedDirectory);
        const second = readListeners(deps, target.port);
        if (!second.ok) return second.reasons.includes("port_not_listening") ? { ok: false, reasons: ["port_owner_changed"] } : second;
        return validatePortOwner(target, expectedDirectory, { listeners: first.listeners, cwd, postmasterPid: pidFile === null ? null : parsePostmasterPid(pidFile), relisted: second.listeners });
    } catch {
        return UNAVAILABLE;
    }
}

export async function runDisposableMigration(config: DisposableConfig, deps: DisposableDeps): Promise<DisposableResult> {
    const completed: DisposableStage[] = [];
    const fail = (stage: DisposableStage, reasons: string[]): DisposableResult => ({ ok: false, stage, reasons, completed });
    const codeOf = (error: unknown) => (error instanceof DisposableError ? error.code : "unexpected_error");

    let target: DatabaseTarget;
    try {
        target = parseDisposableTarget(config.url);
    } catch (error) {
        return fail("target", [codeOf(error)]);
    }
    completed.push("target");

    let expectedDirectory: string;
    try {
        expectedDirectory = validateDataDirectory(config.dataDirectory, config.allowedRoot);
        // The caller's path must already be canonical: a symlinked path could name a different directory than the server reports.
        if (deps.realpathDirectory(expectedDirectory) !== expectedDirectory) return fail("data_directory", ["data_dir_not_canonical_or_missing"]);
    } catch (error) {
        return fail("data_directory", [codeOf(error)]);
    }
    completed.push("data_directory");

    try {
        if (!validatePrismaVersion(deps.readPrismaVersion())) return fail("prisma_version", ["prisma_version_unsupported"]);
    } catch {
        return fail("prisma_version", ["prisma_version_unreadable"]);
    }
    completed.push("prisma_version");

    let knownTables: ReadonlySet<string>;
    let invocations: ReturnType<typeof buildDisposableInvocations>;
    try {
        knownTables = extractKnownTables(deps.readSchemaText());
        const dotenvKeyNames = deps.readDotenvTexts().flatMap(readEnvKeyNames);
        invocations = buildDisposableInvocations({ target, cwd: deps.cwd, nodeExecutable: deps.nodeExecutable, parentEnv: deps.parentEnv, dotenvKeyNames });
        if (!sameEffectiveConfiguration(invocations.status, invocations.deploy)) return fail("port_owner", ["configuration_not_identical"]);
    } catch {
        return fail("port_owner", ["configuration_unavailable"]);
    }

    const ownerVerdict = verifyPortOwner(deps, target, expectedDirectory);
    if (!ownerVerdict.ok) return fail("port_owner", ownerVerdict.reasons);
    completed.push("port_owner");

    try {
        const verdict = validateDatabaseIdentity(target, expectedDirectory, await deps.queryIdentityFacts(target), knownTables);
        if (!verdict.ok) return fail("identity", verdict.reasons);
    } catch {
        return fail("identity", ["identity_query_failed"]);
    }
    completed.push("identity");

    let prismaState: "up_to_date" | "pending";
    try {
        const run = deps.runPrisma(invocations.status);
        if (!run.started) return fail("prisma_status", ["prisma_not_started"]);
        const verdict = evaluatePrismaStatus(run.output, run.status, target);
        if (!verdict.ok) return fail("prisma_status", verdict.reasons);
        prismaState = verdict.state;
    } catch {
        return fail("prisma_status", ["prisma_status_failed"]);
    }
    completed.push("prisma_status");

    if (!config.execute) return { ok: true, mode: "check", completed, prismaState };

    try {
        const run = deps.runPrisma(invocations.deploy);
        if (!run.started) return fail("migrate", ["prisma_not_started"]);
        if (run.status !== 0) return fail("migrate", ["prisma_exit_nonzero"]);
    } catch {
        return fail("migrate", ["prisma_deploy_failed"]);
    }
    completed.push("migrate");
    return { ok: true, mode: "migrate", completed, prismaState };
}
