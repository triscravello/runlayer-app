// Types for target.cjs (kept beside it so TypeScript sees discriminated results; the .cjs stays the single implementation).
export type Failure = { ok: false; code: string };
export type StrictTarget = { host: string; port: number; database: string; key: string; url: string };
export const PROTECTED_PORTS: readonly number[];
export const MIN_PORT: number;
export const SCRATCH_KINDS: readonly string[];
export const DISPOSABLE_DATABASE_NAME: RegExp;
export function parseStrictTarget(raw: unknown): { ok: true; target: StrictTarget } | Failure;
export function scratchDatabaseName(baseDatabase: unknown, kind: unknown, label: unknown, suffix: unknown): { ok: true; name: string } | Failure;
export function isScratchDatabaseName(baseDatabase: unknown, name: unknown, suffix?: string): boolean;
export function checkScratchTarget(baseUrl: unknown, scratchUrl: unknown): { ok: true; base: StrictTarget; scratch: StrictTarget } | Failure;
export function checkExpectedDataDirectory(value: unknown): { ok: true; dataDirectory: string } | Failure;
export function checkAmbientNodeOptions(value: unknown): { ok: true } | Failure;
export function checkRunnerAgreement(env: Readonly<Record<string, string | undefined>>): { ok: true; key: string; dataDirectory: string } | Failure;
export function checkIntegrationTarget(env: Readonly<Record<string, string | undefined>>): { ok: true; url: string; target: StrictTarget } | { ok: false; code: string; reason: string };
