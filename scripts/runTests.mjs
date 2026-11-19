// Test launcher. `npm test` runs the unit suites; `npm run test:integration` runs the opt-in database suites.
//
//   node scripts/runTests.mjs [--dry-run] [test files...]            unit profile
//   node scripts/runTests.mjs --integration [--dry-run] [files...]   integration profile
//
// Both profiles load test-support/isolation/guard.cjs into every Node process through NODE_OPTIONS before any application
// module. (Passing --require on the tsx command line instead changes which files `--test` discovers.) The integration
// profile refuses to start, before spawning anything, unless the target is explicit, local and unambiguous, and it fails
// if any integration test was skipped. Nothing here prints a URL or credential.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const guard = join(root, "test-support", "isolation", "guard.cjs");
const { checkAmbientNodeOptions, checkIntegrationTarget, checkRunnerAgreement } = require("../test-support/isolation/target.cjs");

const args = process.argv.slice(2);
const integration = args.includes("--integration");
const dryRun = args.includes("--dry-run");
const files = args.filter((arg) => !arg.startsWith("--"));

function integrationFiles(dir = root) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...integrationFiles(full));
        else if (entry.name.endsWith(".integration.test.ts")) found.push(relative(root, full));
    }
    return found.sort();
}

if (integration) {
    const check = checkIntegrationTarget(process.env);
    if (!check.ok) {
        console.error(`npm run test:integration refused: ${check.reason}. Nothing was started and no connection was made.`);
        process.exit(2);
    }
    // The suites' target must be the SAME database the disposable-migration wrapper validated (host, port and database name), and the
    // wrapper's expected data directory must be named, so each suite can confirm what actually answers. Codes only; no URL is printed.
    const agreement = checkRunnerAgreement(process.env);
    if (!agreement.ok) {
        console.error(`npm run test:integration refused: ${agreement.code} (RUNLAYER_DISPOSABLE_URL and RUNLAYER_DISPOSABLE_DATA_DIR from \`npm run db:disposable:check\` must agree with RUNLAYER_TEST_DATABASE_URL). Nothing was started and no connection was made.`);
        process.exit(2);
    }
    // Other code must not be loaded ahead of the guard: no ambient --require/--import/--loader preloads.
    const ambient = checkAmbientNodeOptions(process.env.NODE_OPTIONS);
    if (!ambient.ok) {
        console.error(`npm run test:integration refused: ${ambient.code} (unset NODE_OPTIONS). Nothing was started and no connection was made.`);
        process.exit(2);
    }
}

const targets = integration && files.length === 0 ? integrationFiles() : files;
if (integration && targets.length === 0) {
    console.error("npm run test:integration refused: no integration test files were found.");
    process.exit(2);
}

if (dryRun) {
    const plan = { profile: integration ? "integration" : "unit", files: targets.length, guard: relative(root, guard) };
    if (integration) Object.assign(plan, { concurrency: 1, agreedTarget: checkRunnerAgreement(process.env).key });
    console.log(JSON.stringify(plan));
    process.exit(0);
}

const env = {
    ...process.env,
    ...(integration ? { RUNLAYER_TEST_EXPECTED_DATA_DIR: checkRunnerAgreement(process.env).dataDirectory } : {}),
    RUNLAYER_TEST_PROFILE: integration ? "integration" : "unit",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ""}--require ${JSON.stringify(guard)}`,
};
if (integration) {
    // The wrapper's variables served their purpose (validated above); the test processes must not see them.
    for (const name of Object.keys(env)) if (name.startsWith("RUNLAYER_DISPOSABLE_")) delete env[name];
}
const tsx = require.resolve("tsx/cli");
// Integration suites share one database and several count unrelated rows or sessions: they run strictly one file at a time.
const child = spawn(process.execPath, [tsx, "--test", ...(integration ? ["--test-concurrency=1"] : []), ...targets], { cwd: root, env, stdio: ["inherit", "pipe", "inherit"] });

let output = "";
child.stdout.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
});
child.on("close", (code, signal) => {
    if (signal) {
        console.error(`test run ended by signal ${signal}`);
        process.exit(1);
    }
    if (integration && code === 0) {
        const skipped = Number(/(?:^# |ℹ )skipped (\d+)/m.exec(output)?.[1] ?? "0");
        if (skipped > 0) {
            console.error(`npm run test:integration: ${skipped} integration test(s) were skipped although integration testing was explicitly requested. Treating this as a failure.`);
            process.exit(3);
        }
    }
    process.exit(code ?? 1);
});
