import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Regression protection for "every integration suite verifies the connected database's identity before it writes, and again before it cleans up".
//
// The six suites cannot run offline, so this is a STATIC test of their source text. Its limits, stated plainly:
//  - it proves the verification call is present, is built from the shared verifier and the expected data directory, comes textually BEFORE the
//    suite's first write, and is handed to the cleanup machinery; it does not prove the order in which statements execute at run time;
//  - it can be fooled by deliberately obfuscated code (aliasing, string building) and is intentionally brittle to refactors: a reformat that
//    breaks a pattern must be fixed here, in review, rather than silently dropping a check;
//  - the BEHAVIOR of the verifier, the scratch manager and the marker cleanup is covered by real executions in childIsolation.test.ts.
// To show the checks have teeth, each suite's source is also MUTATED (the call removed, a write moved ahead of it, the cleanup recheck or the
// expected data directory dropped) and the inspection must then report a problem.

const root = fileURLToPath(new URL("../../", import.meta.url));

type SuiteSpec = { file: string; kind: "marker" | "scratch"; firstWrite: RegExp; sampleWrite: string };

const SUITES: SuiteSpec[] = [
    { file: "lib/auth/session.integration.test.ts", kind: "marker", firstWrite: /client\.user\.(?:create|update|delete)/, sampleWrite: "await client.user.create({ data: {} });" },
    { file: "lib/db/outfitRepository.integration.test.ts", kind: "marker", firstWrite: /prisma\.(?:user|brand|gearItem|savedOutfit|recommendation|outfitItem)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/, sampleWrite: "await prisma.user.create({ data: {} });" },
    { file: "lib/ingestion/importGear.integration.test.ts", kind: "marker", firstWrite: /prisma\.(?:brand|gearItem)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(|runImport\(/, sampleWrite: "await prisma.brand.create({ data: {} });" },
    { file: "services/gearService.optimisticConcurrency.integration.test.ts", kind: "marker", firstWrite: /prisma\.(?:brand|gearItem)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(|upsertGearItem\(|updateGearItem\(/, sampleWrite: "await prisma.brand.create({ data: {} });" },
    { file: "prisma/brandConstraints.integration.test.ts", kind: "scratch", firstWrite: /await createScratchDatabase\(/, sampleWrite: 'await createScratchDatabase("early");' },
    { file: "prisma/outfitConstraints.integration.test.ts", kind: "scratch", firstWrite: /await createScratchDatabase\(/, sampleWrite: 'await createScratchDatabase("early");' },
];

/** Returns a list of problems; empty means the suite keeps its identity protections. */
export function inspectSuite(source: string, spec: SuiteSpec): string[] {
    const problems: string[] = [];
    if (!/resolveTestDatabase\(process\.env\)/.test(source) || /\bcheckTestDatabase\(process\.env\)/.test(source)) problems.push("target_not_resolved_loudly");

    const definition = /const verifyIdentity = \(\) =>?\s*verifyConnectedIdentity\(([\s\S]*?)\);\n/.exec(source);
    if (!definition) problems.push("verifier_not_defined_from_the_shared_function");
    else {
        // The expected identity is either built inline, or (the constraint suites) is a separate constant that must itself require the data directory.
        const inline = definition[1]?.includes("expectedDataDirectoryFromEnv(process.env)") ?? false;
        const viaConstant = /\bexpectedIdentity\b/.test(definition[1] ?? "") && /const expectedIdentity = expectedIdentityFor\([^;]*expectedDataDirectoryFromEnv\(process\.env\)/.test(source);
        if (!inline && !viaConstant) problems.push("expected_data_directory_not_required");
        if (!definition[1]?.includes("current_setting('data_directory')")) problems.push("data_directory_not_queried");
        if (!definition[1]?.includes("inet_server_port()")) problems.push("port_not_queried");
    }

    const call = source.indexOf("await verifyIdentity();");
    if (call < 0) problems.push("identity_not_verified_before_writes");
    else {
        const afterDefinition = definition ? source.slice((definition.index ?? 0) + definition[0].length) : source;
        const write = afterDefinition.search(spec.firstWrite);
        const writeAt = write < 0 ? -1 : source.length - afterDefinition.length + write;
        if (writeAt >= 0 && writeAt < call) problems.push("write_before_identity_verification");
    }

    if (!/combineFailures\(primaryFailure, cleanupFailure\)/.test(source) || !/primaryFailure = error;\s*throw error;/.test(source)) problems.push("cleanup_failure_may_replace_the_test_failure");

    if (spec.kind === "marker") {
        if (!/runMarkerCleanup\(\{[^}]*verify: verifyIdentity/.test(source)) problems.push("marker_cleanup_not_reverified");
        if (/if \(verified\) \{/.test(source)) problems.push("marker_cleanup_gated_only_by_the_first_check");
        if (!/let verified = false;/.test(source) || !/verified = true;/.test(source)) problems.push("verified_flag_missing");
    } else {
        if (!/createScratchDatabaseManager\(\{[\s\S]*?verifyIdentity,/.test(source)) problems.push("scratch_manager_not_given_the_verifier");
        if (!/scratch\.finish\(\)/.test(source)) problems.push("scratch_cleanup_not_run_through_the_manager");
        if (/\$executeRawUnsafe\(`(?:DROP|CREATE) DATABASE/.test(source)) problems.push("raw_database_ddl_in_the_suite");
    }
    return problems;
}

test("every integration suite verifies the connected identity before its first write and rechecks it before cleanup", () => {
    for (const spec of SUITES) {
        const source = readFileSync(`${root}${spec.file}`, "utf8");
        assert.deepEqual(inspectSuite(source, spec), [], spec.file);
    }
});

test("the inspection has teeth: removing or reordering a verification makes it fail, for every suite", () => {
    for (const spec of SUITES) {
        const source = readFileSync(`${root}${spec.file}`, "utf8");
        assert.deepEqual(inspectSuite(source, spec), [], `${spec.file}: baseline`);

        const withoutCall = source.split("await verifyIdentity();").join("");
        assert.ok(inspectSuite(withoutCall, spec).includes("identity_not_verified_before_writes"), `${spec.file}: removing the verification call must be detected`);

        const writeFirst = source.replace("await verifyIdentity();", `${spec.sampleWrite}\n            await verifyIdentity();`);
        assert.ok(inspectSuite(writeFirst, spec).includes("write_before_identity_verification"), `${spec.file}: a write ahead of the verification must be detected`);

        const noDirectory = source.replace("expectedDataDirectoryFromEnv(process.env)", "undefined");
        assert.ok(inspectSuite(noDirectory, spec).includes("expected_data_directory_not_required"), `${spec.file}: dropping the data-directory requirement must be detected`);

        const noVerifier = source.replace("verifyConnectedIdentity(", "(async () => undefined)(");
        assert.ok(inspectSuite(noVerifier, spec).includes("verifier_not_defined_from_the_shared_function"), `${spec.file}: replacing the shared verifier must be detected`);

        const looseTarget = source.replace("resolveTestDatabase(process.env)", "checkTestDatabase(process.env)");
        assert.ok(inspectSuite(looseTarget, spec).includes("target_not_resolved_loudly"), `${spec.file}: falling back to a silent skip must be detected`);

        const swallowing = source.replace("combineFailures(primaryFailure, cleanupFailure)", "cleanupFailure");
        assert.ok(inspectSuite(swallowing, spec).includes("cleanup_failure_may_replace_the_test_failure"), `${spec.file}: a cleanup failure replacing the test failure must be detected`);

        if (spec.kind === "marker") {
            const noRecheck = source.replace("verify: verifyIdentity", "verify: async () => {}");
            assert.ok(inspectSuite(noRecheck, spec).includes("marker_cleanup_not_reverified"), `${spec.file}: dropping the cleanup recheck must be detected`);
            const oldGate = source.replace("runMarkerCleanup({", "if (verified) {} runMarkerCleanup({");
            assert.ok(inspectSuite(oldGate, spec).includes("marker_cleanup_gated_only_by_the_first_check"), `${spec.file}: gating cleanup on the first check alone must be detected`);
        } else {
            const noManagerVerifier = source.replace(/(createScratchDatabaseManager\(\{[\s\S]*?)verifyIdentity,/, "$1");
            assert.ok(inspectSuite(noManagerVerifier, spec).includes("scratch_manager_not_given_the_verifier"), `${spec.file}: a scratch manager without the verifier must be detected`);
            const rawDrop = source.replace("scratch.finish()", "admin.$executeRawUnsafe(`DROP DATABASE x`)");
            assert.ok(inspectSuite(rawDrop, spec).includes("scratch_cleanup_not_run_through_the_manager"), `${spec.file}: cleanup outside the manager must be detected`);
        }
    }
});
