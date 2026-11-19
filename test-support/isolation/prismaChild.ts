// The ONE way an integration suite runs the Prisma CLI. It validates every target and argument BEFORE spawning, builds a fixed
// allowlisted environment (process.env is never spread into the child), loads child-guard.cjs as the child's only preload, uses an
// argument array with no shell, applies a finite timeout, never retries, and fails closed on spawn errors, timeouts and malformed
// output. A non-zero exit status is NOT an error here (a refused migration is an expected test outcome); it is returned to the test.
//
// The environment allowlist below could not be exercised against the real Prisma CLI in this stage (no live execution was authorized).
// If a live run shows the CLI needs another variable, that is a reviewed change to PASSTHROUGH, never a broader environment.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requireHere = createRequire(import.meta.url);
const { checkScratchTarget, parseStrictTarget } = requireHere("./target.cjs") as typeof import("./target.cjs");
const { OPT_IN_NAME, OPT_IN_VALUE, checkPrismaArgs, expectedNodeOptions } = requireHere("./childPolicy.cjs") as typeof import("./childPolicy.cjs");

const root = fileURLToPath(new URL("../../", import.meta.url));
export const CHILD_GUARD_PATH = fileURLToPath(new URL("./child-guard.cjs", import.meta.url));
export const PRISMA_CLI_PATH = path.join(root, "node_modules", "prisma", "build", "index.js");
export const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** The only variables copied from the parent: what a Node program needs to start and find its files. */
export const PASSTHROUGH = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"] as const;

export class PrismaChildError extends Error {
    readonly code: string;
    constructor(code: string) {
        super(code);
        this.name = "PrismaChildError";
        this.code = code;
    }
}

export type SpawnResult = { status: number | null; stdout?: unknown; stderr?: unknown; error?: Error; signal?: string | null };
export type SpawnFunction = (command: string, args: string[], options: { cwd: string; env: Record<string, string>; encoding: "utf8"; timeout: number; shell: false; maxBuffer: number; windowsHide: true }) => SpawnResult;

export type PrismaRun = {
    /** The base database URL (RUNLAYER_TEST_DATABASE_URL). */
    baseUrl: string;
    /** The scratch database URL the CLI will use as DATABASE_URL. */
    databaseUrl: string;
    /** The temporary project directory: the child's cwd, and the only place its path arguments may point. */
    workdir: string;
    /** Everything after the CLI entry point, e.g. ["migrate", "deploy", "--schema", "<abs path>"]. */
    args: readonly string[];
    timeoutMs?: number;
};

export type PrismaResult = { status: number; output: string };

export const redact = (text: string) => text.replace(/postgres(ql)?:\/\/[^\s"']+/gi, "<url>");

/** Builds the child's environment. Exported for tests: it is the complete list of what the child can see. */
export function buildChildEnvironment(run: Pick<PrismaRun, "baseUrl" | "databaseUrl">, parent: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string>> {
    const env: Record<string, string> = {};
    for (const name of PASSTHROUGH) {
        const value = parent[name];
        if (typeof value === "string" && value !== "") env[name] = value;
    }
    env[OPT_IN_NAME] = OPT_IN_VALUE;
    env.NODE_OPTIONS = expectedNodeOptions(CHILD_GUARD_PATH);
    env.RUNLAYER_TEST_DATABASE_URL = run.baseUrl;
    env.DATABASE_URL = run.databaseUrl;
    env.CHECKPOINT_DISABLE = "1";
    env.PRISMA_HIDE_UPDATE_MESSAGE = "1";
    return Object.freeze(env);
}

/** Throws PrismaChildError (a code, never a URL) unless everything is valid. Nothing is spawned before this passes. */
export function validatePrismaRun(run: PrismaRun, cliPath: string): void {
    if (!parseStrictTarget(run.baseUrl).ok) throw new PrismaChildError("base_target_invalid");
    const scratch = checkScratchTarget(run.baseUrl, run.databaseUrl);
    if (!scratch.ok) throw new PrismaChildError(scratch.code);
    if (typeof run.workdir !== "string" || !path.isAbsolute(run.workdir) || path.normalize(run.workdir) !== run.workdir || run.workdir.endsWith(path.sep)) throw new PrismaChildError("workdir_invalid");
    if (!path.isAbsolute(cliPath)) throw new PrismaChildError("cli_path_invalid");
    const args = checkPrismaArgs([...run.args], { baseUrl: run.baseUrl, workdir: run.workdir });
    if (!args.ok) throw new PrismaChildError(args.code);
    // A diff or migration must run against the scratch database it names.
    const timeout = run.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 600_000) throw new PrismaChildError("timeout_invalid");
}

export function runPrismaCli(run: PrismaRun, deps: { spawn?: SpawnFunction; cliPath?: string; parentEnv?: Readonly<Record<string, string | undefined>> } = {}): PrismaResult {
    const cliPath = deps.cliPath ?? PRISMA_CLI_PATH;
    validatePrismaRun(run, cliPath);
    const spawn = deps.spawn ?? (spawnSync as unknown as SpawnFunction);
    const result = spawn(process.execPath, [cliPath, ...run.args], {
        cwd: run.workdir,
        env: buildChildEnvironment(run, deps.parentEnv ?? process.env) as Record<string, string>,
        encoding: "utf8",
        timeout: run.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        shell: false,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
    });
    if (result.error) throw new PrismaChildError("prisma_child_failed_to_run");
    if (result.signal) throw new PrismaChildError("prisma_child_signalled");
    if (typeof result.status !== "number" || !Number.isInteger(result.status) || result.status < 0 || result.status > 255) throw new PrismaChildError("prisma_child_status_invalid");
    if (typeof result.stdout !== "string" || typeof result.stderr !== "string") throw new PrismaChildError("prisma_child_output_malformed");
    return { status: result.status, output: redact(`${result.stdout}\n${result.stderr}`) };
}

/** The environment for a suite's `psql` call: the same allowlist, plus the one password. No hosted or PG* variable can reach it. */
export function buildPsqlEnvironment(password: string, parent: Readonly<Record<string, string | undefined>> = process.env): NodeJS.ProcessEnv {
    const env: Record<string, string> = {};
    for (const name of PASSTHROUGH) {
        const value = parent[name];
        if (typeof value === "string" && value !== "") env[name] = value;
    }
    env.PGPASSWORD = password;
    return env as unknown as NodeJS.ProcessEnv;
}

/** For the suites' `psql` calls: the database URL must be a scratch database of the base before it is used. */
export function assertScratchUrl(baseUrl: string, url: string): void {
    const scratch = checkScratchTarget(baseUrl, url);
    if (!scratch.ok) throw new PrismaChildError(scratch.code);
}
