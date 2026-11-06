import { validateEnv } from "./envValidation";

type EnvSource = Readonly<Record<string, string | undefined>>;

/** Thrown at server start when the production configuration is invalid. Its message lists problems, never values. */
export class EnvironmentConfigurationError extends Error {
    readonly problems: readonly string[];

    constructor(problems: readonly string[]) {
        super(`Invalid production configuration (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
        this.name = "EnvironmentConfigurationError";
        this.problems = problems;
    }
}

/**
 * Whether the production environment must be validated now.
 *  - Only when NODE_ENV is "production". Development, test and unset environments are never checked here, so local
 *    development and the offline tests need no production secrets.
 *  - Never during `next build` (NEXT_PHASE=phase-production-build): the build runs without the production runtime secrets
 *    on some hosts, and it must not fail for want of them. (Next.js itself also skips instrumentation during the build.)
 */
export function shouldValidateRuntimeEnv(env: EnvSource): boolean {
    return env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build";
}

/**
 * Throws an EnvironmentConfigurationError when the production configuration is invalid. Delegates to validateEnv, whose
 * messages never contain secret values. Does nothing outside a running production server (see shouldValidateRuntimeEnv).
 * Called from instrumentation.ts, which turns the error into a process exit via terminateStartup.
 */
export function assertValidRuntimeEnv(env: EnvSource): void {
    if (!shouldValidateRuntimeEnv(env)) return;

    const problems = validateEnv(env);
    if (problems.length > 0) throw new EnvironmentConfigurationError(problems);
}

// ---------------------------------------------------------------------------------------------------------------------
// Terminating the server
//
// WHY THIS EXISTS. Throwing from register() is not enough. Next.js 16 binds the HTTP port first ("setup server listener as fast
// as possible" in server/lib/start-server.js) and prints "Ready"; only then does NextServer run prepare(), and register() runs
// inside it. prepare() is started fire-and-forget with `.catch(console.error("Failed to prepare server", err))`, so a rejection
// is logged and swallowed, the process keeps listening, and every request awaits the same rejected promise and gets HTTP 500.
// Nothing in Next turns a failed register() into an exit. So, on this one validated path, we exit ourselves.
//
// WHY IT IS SAFE. It runs only after assertValidRuntimeEnv has thrown, which can only happen for NODE_ENV=production outside the
// build, in the Node.js runtime, at server start (see instrumentation.ts). `next start` runs the listening server in the same
// process (cli/next-start.js calls startServer directly), so exiting here stops the listener. Development, tests and the build
// never reach it.
// ---------------------------------------------------------------------------------------------------------------------

/** I/O used to report the failure and exit. Injectable so tests never call the real process.exit. */
export type StartupIo = {
    /** Writes to stderr and calls `done` once the text has been flushed. */
    writeError: (text: string, done: () => void) => void;
    exit: (code: number) => void;
};

/** Read at call time (not captured), so a test that replaces process.exit / process.stderr.write is honored. */
const processIo: StartupIo = {
    writeError: (text, done) => {
        process.stderr.write(text, () => done());
    },
    exit: (code) => process.exit(code),
};

/** If a stuck stream never reports the message as flushed, exit anyway after this long. */
export const EXIT_FLUSH_TIMEOUT_MS = 2000;

/**
 * The text printed when startup is refused. For a configuration error that is its message (variable names and rules, never
 * values). For anything else only the error's class name is printed, because an unexpected error's message could contain
 * anything.
 */
export function describeStartupFailure(error: unknown): string {
    if (error instanceof EnvironmentConfigurationError) return error.message;
    return `Startup validation failed unexpectedly (${error instanceof Error ? error.name : "UnknownError"}).`;
}

/**
 * Reports why the server cannot start and exits with status 1 once the message is flushed (or after `flushTimeoutMs`, by
 * default EXIT_FLUSH_TIMEOUT_MS, whichever comes first).
 *
 * The returned promise NEVER settles. register() returns it, so Next's prepare() cannot finish and no request is handled in
 * the moment between this call and the exit. Exits at most once.
 */
export function terminateStartup(error: unknown, io: StartupIo = processIo, flushTimeoutMs: number = EXIT_FLUSH_TIMEOUT_MS): Promise<never> {
    let exited = false;

    // `timer` is read only when exitOnce runs, which can only happen after the line below has created it.
    const exitOnce = () => {
        if (exited) return;
        exited = true;
        clearTimeout(timer);
        io.exit(1);
    };

    const timer = setTimeout(exitOnce, flushTimeoutMs);
    io.writeError(`${describeStartupFailure(error)}\nThe server will not start; exiting with status 1.\n`, exitOnce);

    return new Promise<never>(() => {});
}
