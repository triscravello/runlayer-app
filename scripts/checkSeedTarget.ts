// `npm run db:seed:check`: reports whether the seed commands would be allowed to run, WITHOUT connecting to any
// database. Run from the project root. Only configuration files are read, and nothing sensitive is printed.
import { readFileSync } from "node:fs";
import { checkSeedScenarios } from "../prisma/seeds/check.ts";

function read(path: string): string | undefined {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return undefined;
    }
}

const result = checkSeedScenarios({
    processEnv: process.env,
    dotEnv: read(".env"),
    seedLocalEnv: read(".env.seed.local"),
});

for (const line of result.lines) {
    console.log(line);
}

process.exitCode = result.ok ? 0 : 1;
