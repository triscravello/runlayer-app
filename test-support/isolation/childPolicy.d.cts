// Types for childPolicy.cjs.
import type { Failure, StrictTarget } from "./target.cjs";
export const OPT_IN_NAME: string;
export const OPT_IN_VALUE: string;
export function expectedNodeOptions(guardPath: string): string;
export function checkChildEnvironment(env: Readonly<Record<string, string | undefined>>, guardPath: string): { ok: true; base: StrictTarget; scratch: StrictTarget } | Failure;
export function checkPrismaArgs(args: unknown, options?: { baseUrl?: unknown; workdir?: string }): { ok: true } | Failure;
