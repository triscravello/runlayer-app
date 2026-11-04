// Pure helper (no framework imports, no path aliases) so seed scripts running under
// `node --experimental-strip-types` can use it too.

/**
 * A log-safe description of an error: its name and, for database errors, its code. Messages are deliberately
 * excluded because database error messages can contain query arguments such as user identifiers or password hashes.
 */
export function describeErrorForLog(error: unknown): string {
    if (!(error instanceof Error)) return "UnknownError";

    const code = (error as { code?: unknown }).code;
    return typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? `${error.name}:${code}` : error.name;
}
