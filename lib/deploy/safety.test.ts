import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import net from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertTargetAllowed, assertTargetConfirmed, parseDatabaseTarget, parseTargetAllowlist } from "./databaseTarget";
import { evaluateGuard, buildPrismaInvocation } from "./migrationGuard";
import { collectPreflight, type ReadOnlyQueryable } from "./preflightQueries";
import { CONTEXT, MIGRATIONS, NOW, TARGET, TARGET_URL, behindFacts, reportFor } from "./testFixtures";

// Source-level and runtime checks that the offline deployment tooling cannot reach a database by accident.

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const read = (path: string) => readFileSync(root(path), "utf8");

const libSources = readdirSync(root("lib/deploy")).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "testFixtures.ts");

/** Source with comments removed, so prose that merely mentions a name does not count as a use of it. */
function code(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("no deployment tooling reads DATABASE_URL from the environment", () => {
    for (const path of [...libSources.map((name) => `lib/deploy/${name}`), "scripts/preflight.ts", "scripts/migrateGuarded.ts", "config/startupEnv.ts"]) {
        const source = code(read(path));
        // Any READ of a DATABASE_URL member or key. Assigning it on the child process's own environment object is the one
        // legitimate use (the wrapper hands Prisma the approved target) and is not matched.
        assert.doesNotMatch(source, /\.DATABASE_URL\b(?!\s*=[^=])|\[\s*["'`]DATABASE_URL["'`]\s*\]/, path);
        assert.doesNotMatch(source, /dotenv|--env-file|loadEnvFile/, path);
    }
});

test("only the preflight script creates a database client, and the pure modules cannot connect", () => {
    for (const name of libSources) {
        const source = code(read(`lib/deploy/${name}`));
        assert.doesNotMatch(source, /PrismaClient|from ["']pg["']|from ["']node:(net|tls|http|https|child_process|dgram)["']|require\(["']pg["']\)|fetch\(/, name);
    }

    assert.match(code(read("scripts/preflight.ts")), /new PrismaClient\(/);
    assert.doesNotMatch(code(read("scripts/migrateGuarded.ts")), /PrismaClient|from ["']pg["']/);
});

test("the preflight script sends only the fixed session setup and registered read-only statements", () => {
    const source = code(read("scripts/preflight.ts"));
    assert.equal((source.match(/\$executeRaw\w*/g) ?? []).length, 1, "exactly one execute call (the session setup loop)");
    assert.match(source, /for \(const statement of SESSION_SETUP_SQL\) await tx\.\$executeRawUnsafe\(statement\)/);
    assert.equal((source.match(/\$queryRaw\w*/g) ?? []).length, 1, "queries go only through the checked queryable");
    assert.doesNotMatch(source, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$transaction\(\s*\[/);
    assert.match(source, /flag: "wx"/, "an existing report is never overwritten");
});

test("the migration wrapper never uses a shell, npx, or user-supplied Prisma arguments", () => {
    const source = code(read("scripts/migrateGuarded.ts"));
    assert.doesNotMatch(source, /shell:\s*true|\bexec\(|execSync|\bnpx\b/);
    assert.equal((source.match(/spawnSync\(/g) ?? []).length, 1);
    assert.match(source, /if \(!decision\.execute\)/, "check mode returns before anything is started");
    assert.ok(source.indexOf("if (!decision.execute)") < source.indexOf("spawnSync("), "the check-only return precedes the spawn");
});

test("npm scripts: the unguarded Prisma deploy is gone and execution has its own name", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;

    for (const [name, command] of Object.entries(scripts)) {
        assert.doesNotMatch(command, /migrate\s+(deploy|dev|reset)|db\s+push/, `${name} must not run an unguarded migration`);
    }
    assert.match(scripts["db:deploy"], /migrateGuarded\.ts$/);
    assert.doesNotMatch(scripts["db:deploy"], /--execute/);
    assert.match(scripts["db:deploy:execute"], /migrateGuarded\.ts --execute$/);
    assert.match(scripts["db:preflight"], /preflight\.ts$/);
    assert.doesNotMatch(scripts.postinstall, /migrate|db:/);
    for (const lifecycle of ["dev", "build", "start", "postinstall", "test"]) assert.doesNotMatch(scripts[lifecycle], /db:deploy|migrateGuarded|preflight/, lifecycle);
});

test("the exercised pipeline opens no network connection", async () => {
    const attempts: unknown[] = [];
    const original = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args: unknown[]) {
        attempts.push(args);
        throw new Error("network access is not allowed in offline tests");
    } as typeof net.Socket.prototype.connect;

    try {
        const target = parseDatabaseTarget(TARGET_URL);
        assertTargetAllowed(target, parseTargetAllowlist(TARGET.key));
        assertTargetConfirmed(target, TARGET.key);

        const decision = evaluateGuard({
            env: { RUNLAYER_MIGRATE_TARGET_URL: TARGET_URL, RUNLAYER_DB_ALLOWED_TARGETS: TARGET.key, RUNLAYER_MIGRATE_CONFIRM_TARGET: TARGET.key },
            argv: ["--evidence", "x.json", "--execute"],
            now: NOW,
            migrationSet: MIGRATIONS,
            readEvidence: () => JSON.stringify(reportFor(behindFacts())),
        });
        assert.ok(decision.ok);
        buildPrismaInvocation({ target, cwd: "/repo", nodeExecutable: "node", parentEnv: {} });

        const queryable: ReadOnlyQueryable = {
            async query<T>() {
                return [{ database: "appdb", server_version: "17.10", transaction_read_only: "on", in_recovery: false, is_superuser: false, can_create: false }] as T[];
            },
        };
        await assert.rejects(collectPreflight(queryable, CONTEXT)); // stops on the canned rows; the point is that it never connects
    } finally {
        net.Socket.prototype.connect = original;
    }

    assert.equal(attempts.length, 0);
});
