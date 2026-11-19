// Cleanup of the rows a suite created in the shared (base) database, and the reporting of a cleanup problem NEXT TO the test's own
// failure. Cleanup deletes only rows whose names carry this run's random marker, and only after the server's identity has been verified
// AGAIN: a check made when the suite started says nothing about the server that is answering now. Everything is injected, so the rules
// are testable with fakes and no connection.

/** Sanitized reason codes (lower-case words and underscores) only; nothing else from a cause is copied into a message. */
const reasonCodes = (cause: unknown): string[] => {
    const reasons = (cause as { reasons?: unknown } | null | undefined)?.reasons;
    return Array.isArray(reasons) && reasons.every((reason) => typeof reason === "string" && /^[a-z0-9_]+$/.test(reason)) ? (reasons as string[]) : [];
};

export class MarkerCleanupError extends Error {
    readonly code: "marker_cleanup_refused" | "marker_cleanup_failed";
    readonly marker: string;
    constructor(code: MarkerCleanupError["code"], marker: string, detail: { cause?: unknown; note: string }) {
        const reasons = reasonCodes(detail.cause);
        super(`${code}: marker ${marker} (${detail.note})${reasons.length ? ` [identity: ${reasons.join(", ")}]` : ""}`, detail.cause === undefined ? undefined : { cause: detail.cause });
        this.name = "MarkerCleanupError";
        this.code = code;
        this.marker = marker;
    }
}

export type MarkerCleanupResult = "cleaned" | "nothing_to_clean";

/**
 * Runs the marker deletions only if the suite had verified the server at the start AND the server verifies again now.
 *  - never verified: nothing was written (every write comes after the first verification), so nothing is deleted and nothing is reported;
 *  - verification fails now: NO deletion is sent and a MarkerCleanupError says so, naming the marker (the rows remain);
 *  - a deletion fails: the others are still attempted, and a MarkerCleanupError reports how many failed.
 * Matching is by the caller's marker prefix only; this function never widens it.
 */
export async function runMarkerCleanup(input: { marker: string; verified: boolean; verify: () => Promise<void>; deletions: ReadonlyArray<() => Promise<unknown>> }): Promise<MarkerCleanupResult> {
    if (!input.verified) return "nothing_to_clean";
    try {
        await input.verify();
    } catch (cause) {
        throw new MarkerCleanupError("marker_cleanup_refused", input.marker, { cause, note: "the server failed identity verification before cleanup: no DELETE was sent and rows carrying the marker remain" });
    }
    let failures = 0;
    let first: unknown;
    for (const deletion of input.deletions) {
        try {
            await deletion();
        } catch (error) {
            failures += 1;
            first ??= error;
        }
    }
    if (failures > 0) throw new MarkerCleanupError("marker_cleanup_failed", input.marker, { cause: first, note: `${failures} of ${input.deletions.length} deletion(s) failed; rows carrying the marker may remain` });
    return "cleaned";
}

/**
 * A cleanup failure must never replace the test's own failure. With no primary failure the cleanup failure is returned as is; with
 * both, one AggregateError carries both (originals in `errors`) and its message shows the test failure first.
 */
export function combineFailures(primary: unknown, cleanup: unknown): unknown {
    if (primary === undefined) return cleanup;
    const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
    return new AggregateError([primary, cleanup], `${describe(primary)}\n--- the cleanup ALSO failed: ${describe(cleanup)}`);
}
