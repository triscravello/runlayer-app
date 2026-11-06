// Next.js calls register() once when a server instance starts (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md). It is used here only to stop the
// server when the production configuration is invalid.
//
// - Node.js runtime only: the validation code reads process.env and is not written for the Edge runtime.
// - Production server only: config/startupEnv.ts skips development, test, and `next build` (Next also skips instrumentation
//   during the build).
// - On an invalid configuration the process EXITS with status 1; throwing is not enough. Next.js 16 has already bound the port
//   by the time register() runs and swallows a rejection from it, so a thrown error would leave the server listening and
//   answering every request with HTTP 500. See "Terminating the server" in config/startupEnv.ts.
// - The message lists the problems and never a secret value.
export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;

    const { assertValidRuntimeEnv, terminateStartup } = await import("./config/startupEnv");

    try {
        assertValidRuntimeEnv(process.env);
    } catch (error) {
        // Never settles: Next cannot finish preparing, so no request is served before the process exits.
        return terminateStartup(error);
    }
}
