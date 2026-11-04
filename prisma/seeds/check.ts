// Read-only seed-target report used by `npm run db:seed:check`. It NEVER opens a database connection: it only
// evaluates configuration with the same pure rules the seed guard applies. Output is built from fixed strings and
// never contains URLs, hosts, credentials or passwords. Erasable TypeScript only.
import { describeTarget, evaluateSeedTarget, validateSeedPassword } from "./safety.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;

export const SEED_CHECK_EMAIL = "user@example.com";

/** Minimal .env parser (KEY=VALUE, optional export, quotes, # comments). Values are only returned, never printed. */
export function parseDotenv(content: string): Record<string, string> {
    const result: Record<string, string> = {};

    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!match) continue;

        let value = match[2].trim();
        const quote = value[0];
        if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
            value = value.slice(1, -1);
        } else {
            const comment = value.indexOf(" #");
            if (comment !== -1) value = value.slice(0, comment).trim();
        }

        result[match[1]] = value;
    }

    return result;
}

/** First layer that defines a key wins, matching how existing variables beat later-loaded .env files. */
export function mergeEnv(layers: Array<EnvSource | undefined>): Record<string, string | undefined> {
    const merged: Record<string, string | undefined> = {};

    for (const layer of layers) {
        if (!layer) continue;
        for (const [key, value] of Object.entries(layer)) {
            if (!(key in merged) && value !== undefined) merged[key] = value;
        }
    }

    return merged;
}

function describeScenario(label: string, env: EnvSource): { line: string; ok: boolean } {
    const verdict = evaluateSeedTarget(env);
    if (!verdict.ok) {
        return { line: `${label}: REJECTED [${verdict.code}] ${verdict.message}`, ok: false };
    }

    const passwordProblem = validateSeedPassword(env.SEED_USER_PASSWORD, SEED_CHECK_EMAIL);
    if (passwordProblem) {
        return { line: `${label}: target accepted (${describeTarget(verdict.target)}), but ${passwordProblem}`, ok: false };
    }

    return { line: `${label}: ACCEPTED (${describeTarget(verdict.target)}; seed password acceptable)`, ok: true };
}

export function checkSeedScenarios(input: { processEnv: EnvSource; dotEnv?: string; seedLocalEnv?: string }): { lines: string[]; ok: boolean } {
    const dotEnv = input.dotEnv === undefined ? undefined : parseDotenv(input.dotEnv);
    const seedLocal = input.seedLocalEnv === undefined ? undefined : parseDotenv(input.seedLocalEnv);

    // `npm run db:seed`: Prisma loads .env; variables already in the environment win.
    const defaultScenario = describeScenario("npm run db:seed (uses .env)", mergeEnv([input.processEnv, dotEnv]));

    // `npm run db:seed:local`: .env.seed.local is loaded first, so it wins over .env; the environment wins over both.
    const localScenario = seedLocal
        ? describeScenario("npm run db:seed:local (uses .env.seed.local)", mergeEnv([input.processEnv, seedLocal, dotEnv]))
        : { line: "npm run db:seed:local (uses .env.seed.local): NOT CONFIGURED (.env.seed.local was not found; see the README)", ok: false };

    return {
        lines: [
            "Seed target check (read-only: no database connection is made)",
            defaultScenario.line,
            localScenario.line,
            "The server's own identity is verified again, by one read-only query, when a seed actually runs.",
        ],
        ok: localScenario.ok,
    };
}
