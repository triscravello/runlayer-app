import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { verifyPassword } from "../../lib/auth/password";
import { normalizeBrandKey } from "../../lib/ingestion/brandResolution";
import type { SeedDeps, SeedPrisma } from "./context";
import { loadGearSeedData } from "./data/gear.data";
import { seedGearCatalog } from "./gear.seed";
import { DEMO_OUTFIT_NAME, seedDemoOutfit } from "./outfit.seed";
import { runSeed } from "./run";
import { SeedSafetyError } from "./safety";
import { SEED_USER_EMAIL, seedUserProfile } from "./user.seed";

const PASSWORD = "k9#Vq2-Lm7!xR4tZ";
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

type Row = Record<string, unknown> & { id: string };

/**
 * In-memory stand-in for the database. Every method the seeds must NOT use (update, upsert on records, delete, ...)
 * is a trap that records the call and throws, so any overwrite or deletion fails the test that triggered it.
 */
function createFakePrisma(initial: { users?: Row[]; outfits?: Row[]; gear?: Row[]; brands?: Row[] } = {}, options: { raceOnUserCreate?: boolean; failUserCreateWith?: string } = {}) {
    const calls: string[] = [];
    const brandUpsertUpdates: unknown[] = [];
    const brandUpsertCreates: Array<{ name: string; normalizedName: string }> = [];
    const users = [...(initial.users ?? [])];
    const outfits = [...(initial.outfits ?? [])];
    const gear = [...(initial.gear ?? [])];
    const brands = [...(initial.brands ?? [])];
    let counter = 0;
    const nextId = (prefix: string) => `${prefix}-${++counter}`;

    const trap = (name: string) => async () => {
        calls.push(name);
        throw new Error(`forbidden operation: ${name}`);
    };

    const prisma = {
        user: {
            findUnique: async ({ where }: { where: { email: string } }) => {
                calls.push("user.findUnique");
                const row = users.find((user) => user.email === where.email);
                return row ? { id: row.id } : null;
            },
            create: async ({ data }: { data: Record<string, unknown> }) => {
                calls.push("user.create");
                if (options.failUserCreateWith) {
                    throw Object.assign(new Error("db down"), { code: options.failUserCreateWith });
                }
                if (options.raceOnUserCreate) {
                    users.push({ id: nextId("raced"), email: data.email as string, passwordHash: "someone-elses-hash" });
                    throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
                }
                const row: Row = { id: nextId("user"), ...data };
                users.push(row);
                return { id: row.id };
            },
            update: trap("user.update"),
            updateMany: trap("user.updateMany"),
            upsert: trap("user.upsert"),
            delete: trap("user.delete"),
            deleteMany: trap("user.deleteMany"),
        },
        savedOutfit: {
            findFirst: async ({ where }: { where: { userId: string; name: string } }) => {
                calls.push("savedOutfit.findFirst");
                const row = outfits.find((outfit) => outfit.userId === where.userId && outfit.name === where.name);
                return row ? { id: row.id } : null;
            },
            create: async ({ data }: { data: Record<string, unknown> }) => {
                calls.push("savedOutfit.create");
                const row: Row = { id: nextId("outfit"), ...data };
                outfits.push(row);
                return { id: row.id };
            },
            update: trap("savedOutfit.update"),
            updateMany: trap("savedOutfit.updateMany"),
            upsert: trap("savedOutfit.upsert"),
            delete: trap("savedOutfit.delete"),
            deleteMany: trap("savedOutfit.deleteMany"),
        },
        brand: {
            // Brands are looked up by their unique normalized key (an existing row's key is derived from its name when the
            // fixture does not carry one, like rows written before the key existed).
            upsert: async ({ where, update, create }: { where: { normalizedName: string }; update: unknown; create: { name: string; normalizedName: string } }) => {
                calls.push("brand.upsert");
                brandUpsertUpdates.push(update);
                brandUpsertCreates.push(create);
                const existing = brands.find((brand) => (brand.normalizedName ?? normalizeBrandKey(String(brand.name))) === where.normalizedName);
                if (existing) return existing;
                const row: Row = { id: nextId("brand"), ...create };
                brands.push(row);
                return row;
            },
            update: trap("brand.update"),
            delete: trap("brand.delete"),
            deleteMany: trap("brand.deleteMany"),
        },
        gearItem: {
            findFirst: async ({ where }: { where: { name: string; brandId: string } }) => {
                calls.push("gearItem.findFirst");
                const row = gear.find((item) => item.name === where.name && item.brandId === where.brandId);
                return row ? { id: row.id } : null;
            },
            create: async ({ data }: { data: Record<string, unknown> }) => {
                calls.push("gearItem.create");
                const row: Row = { id: nextId("gear"), ...data };
                gear.push(row);
                return { id: row.id };
            },
            update: trap("gearItem.update"),
            updateMany: trap("gearItem.updateMany"),
            upsert: trap("gearItem.upsert"),
            delete: trap("gearItem.delete"),
            deleteMany: trap("gearItem.deleteMany"),
        },
    };

    return { prisma: prisma as unknown as SeedPrisma, calls, users, outfits, gear, brands, brandUpsertUpdates, brandUpsertCreates };
}

function allowed(fake: ReturnType<typeof createFakePrisma>, env: Record<string, string | undefined> = { SEED_USER_PASSWORD: PASSWORD }) {
    const guardCalls = { count: 0 };
    const deps: SeedDeps = {
        prisma: fake.prisma,
        assertSafe: async () => {
            guardCalls.count += 1;
        },
        env,
    };

    return { deps, guardCalls };
}

function silence(t: TestContext) {
    t.mock.method(console, "log", () => {});
}

const rejectingGuard = async () => {
    throw new SeedSafetyError("hosted_database", "rejected for the test");
};

// --- the guard runs first: no queries when the target is rejected -------------------------

test("when the safety guard rejects, no seed step issues a single query", async () => {
    const entryPoints: Array<[string, (deps: SeedDeps) => Promise<unknown>]> = [
        ["runSeed", (deps) => runSeed(deps)],
        ["seedUserProfile", (deps) => seedUserProfile(deps)],
        ["seedGearCatalog", (deps) => seedGearCatalog(deps)],
        ["seedDemoOutfit", (deps) => seedDemoOutfit({ ...deps, userId: "some-user" })],
    ];

    for (const [name, run] of entryPoints) {
        const fake = createFakePrisma();

        await assert.rejects(run({ prisma: fake.prisma, assertSafe: rejectingGuard, env: { SEED_USER_PASSWORD: PASSWORD } }), SeedSafetyError, name);
        assert.deepEqual(fake.calls, [], `${name} must not touch the database after a rejection`);
    }
});

test("every seed step runs the guard, so executing any seed directly is protected", async (t) => {
    silence(t);

    for (const run of [(deps: SeedDeps) => seedUserProfile(deps), (deps: SeedDeps) => seedGearCatalog(deps), (deps: SeedDeps) => seedDemoOutfit({ ...deps, userId: "u" })]) {
        const { deps, guardCalls } = allowed(createFakePrisma({ users: [{ id: "u", email: SEED_USER_EMAIL }] }));
        await run(deps);
        assert.equal(guardCalls.count, 1);
    }
});

test("the guard runs before the database client is obtained (structure)", () => {
    const context = read("prisma/seeds/context.ts");
    const body = context.slice(context.indexOf("export async function prepareSeed"));

    assert.ok(body.indexOf("assertSafe") !== -1 && body.indexOf("loadDefaultClient()") !== -1);
    assert.ok(body.indexOf("assertSafe") < body.indexOf("loadDefaultClient()"), "assertSafe precedes loadDefaultClient");
    assert.doesNotMatch(context, /^import .*lib\/prisma/m, "the application client is imported lazily, never at module load");
});

test("each seed function's first statement is the guard", () => {
    for (const [path, signature] of [
        ["prisma/seeds/user.seed.ts", "export async function seedUserProfile"],
        ["prisma/seeds/gear.seed.ts", "export async function seedGearCatalog"],
        ["prisma/seeds/outfit.seed.ts", "export async function seedDemoOutfit"],
        ["prisma/seeds/run.ts", "export async function runSeed"],
    ] as const) {
        const source = read(path);
        const fromSignature = source.slice(source.indexOf(signature));
        assert.ok(fromSignature.startsWith(signature), `${path}: signature found`);

        // Each signature is a single line; the body starts on the next one.
        const bodyLines = fromSignature.slice(fromSignature.indexOf("\n") + 1).split("\n").map((line) => line.trim());
        const firstStatement = bodyLines.find((line) => line && !line.startsWith("//"));

        assert.ok(firstStatement, `${path}: has a body`);
        assert.match(firstStatement, /await prepareSeed\(/, `${path}: first statement is "${firstStatement}"`);
    }
});

// --- password required before any write ---------------------------------------------------------

test("a missing or weak SEED_USER_PASSWORD aborts before any query", async () => {
    const legacyDefault = ["Pass", "word123"].join("");

    for (const password of [undefined, "", "short", legacyDefault, "aaaaaaaaaaaaaaaa"]) {
        const fake = createFakePrisma();
        const { deps } = allowed(fake, { SEED_USER_PASSWORD: password });

        await assert.rejects(seedUserProfile(deps), (error: unknown) => error instanceof SeedSafetyError && error.code === "invalid_password");
        assert.deepEqual(fake.calls, [], "no reads or writes");
    }
});

// --- user seed: create-only, real ids, no overwrite ---------------------------------------------------

test("the demo user is created once with a hashed password and the database-generated id", async (t) => {
    silence(t);
    const fake = createFakePrisma();
    const { deps } = allowed(fake);

    const result = await seedUserProfile(deps);

    assert.equal(result.created, true);
    assert.equal(fake.users.length, 1);
    const user = fake.users[0];
    assert.equal(result.userId, user.id);
    assert.notEqual(user.id, "user-id-1", "no assumed fixed id");
    assert.equal(user.email, SEED_USER_EMAIL);

    const hash = user.passwordHash as string;
    assert.match(hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
    assert.ok(!hash.includes(PASSWORD));
    assert.equal(verifyPassword(PASSWORD, hash), true);
    assert.equal(user.role, undefined, "the seed never creates an administrator");
    assert.ok((user.profile as { create: object }).create, "the profile is created together with the user");
});

test("an existing account is left completely untouched: password, profile and id", async (t) => {
    silence(t);
    const existing: Row = { id: "real-account-id", email: SEED_USER_EMAIL, passwordHash: "salt:real-existing-hash", profile: { location: "Edited, CO" } };
    const fake = createFakePrisma({ users: [existing] });
    const before = JSON.stringify(existing);

    const result = await seedUserProfile(allowed(fake).deps);

    assert.deepEqual(result, { userId: "real-account-id", created: false });
    assert.equal(JSON.stringify(fake.users[0]), before, "the row is byte-for-byte unchanged");
    assert.deepEqual(fake.calls, ["user.findUnique"], "the only operation is a lookup");
});

test("losing a creation race falls back to the existing account without modifying it", async (t) => {
    silence(t);
    const fake = createFakePrisma({}, { raceOnUserCreate: true });

    const result = await seedUserProfile(allowed(fake).deps);

    assert.equal(result.created, false);
    assert.equal(fake.users.length, 1);
    assert.equal(fake.users[0].passwordHash, "someone-elses-hash");
    assert.ok(!fake.calls.some((call) => call.includes("update") || call.includes("upsert")));
});

test("unexpected creation errors are not swallowed", async () => {
    const fake = createFakePrisma({}, { failUserCreateWith: "P1001" });

    await assert.rejects(seedUserProfile(allowed(fake).deps), /db down/);
});

// --- outfit seed ----------------------------------------------------------------------------------------

test("the demo outfit is created for the user's real id, only once, and never overwritten", async (t) => {
    silence(t);
    const fake = createFakePrisma({ users: [{ id: "real-account-id", email: SEED_USER_EMAIL }] });
    const { deps } = allowed(fake);

    assert.deepEqual(await seedDemoOutfit({ ...deps, userId: "real-account-id" }), { created: true });
    assert.deepEqual(await seedDemoOutfit({ ...deps, userId: "real-account-id" }), { created: false });
    assert.deepEqual(await seedDemoOutfit(deps), { created: false }, "the user can also be looked up by email");

    assert.equal(fake.outfits.length, 1);
    assert.equal(fake.outfits[0].userId, "real-account-id");
    assert.equal(fake.outfits[0].name, DEMO_OUTFIT_NAME);
    assert.notEqual(fake.outfits[0].id, "outfit-id-1");
});

test("an edited demo outfit is preserved", async (t) => {
    silence(t);
    const edited: Row = { id: "o1", userId: "u1", name: DEMO_OUTFIT_NAME, isFavorite: false, description: "my edit" };
    const fake = createFakePrisma({ users: [{ id: "u1", email: SEED_USER_EMAIL }], outfits: [edited] });
    const before = JSON.stringify(edited);

    await seedDemoOutfit({ ...allowed(fake).deps, userId: "u1" });

    assert.equal(JSON.stringify(fake.outfits[0]), before);
});

test("the outfit seed refuses to guess a user that does not exist", async () => {
    const fake = createFakePrisma();

    await assert.rejects(seedDemoOutfit(allowed(fake).deps), /demo user does not exist/);
    assert.ok(!fake.calls.includes("savedOutfit.create"));
});

// --- gear seed: create-only -------------------------------------------------------------------------------------

test("the gear seed creates the catalog on first run and changes nothing on the second", async (t) => {
    silence(t);
    const fake = createFakePrisma();
    const { deps } = allowed(fake);
    const total = loadGearSeedData().length;

    const first = await seedGearCatalog(deps);
    assert.deepEqual(first, { created: total, skipped: 0 });
    assert.equal(fake.gear.length, total);

    const snapshot = JSON.stringify(fake.gear);
    const second = await seedGearCatalog(deps);

    assert.deepEqual(second, { created: 0, skipped: total });
    assert.equal(JSON.stringify(fake.gear), snapshot, "repeat seeding leaves every record identical");
    assert.ok(fake.brandUpsertUpdates.every((update) => JSON.stringify(update) === "{}"), "brand upserts never update");
});

test("the gear seed stores every brand with the shared normalized key and reuses an equivalent existing brand", async (t) => {
    silence(t);

    // Every brand the seed creates carries the key the application computes for its display name.
    const fresh = createFakePrisma();
    await seedGearCatalog(allowed(fresh).deps);
    assert.ok(fresh.brandUpsertCreates.length > 0);
    for (const create of fresh.brandUpsertCreates) {
        assert.equal(create.normalizedName, normalizeBrandKey(create.name), `${create.name}: stored key is the shared key`);
        assert.equal(create.name, create.name.trim().replace(/\s+/g, " "), `${create.name}: display name is the cleaned input`);
    }
    assert.equal(new Set(fresh.brands.map((brand) => brand.normalizedName)).size, fresh.brands.length, "no two seeded brands share a key");

    // A brand that already exists under an equivalent spelling (written before keys existed, so without one) is reused:
    // no second row, same id, same display name.
    const [first] = loadGearSeedData();
    const original = first.brand === first.brand.toLowerCase() ? first.brand.toUpperCase() : first.brand.toLowerCase();
    const existing = createFakePrisma({ brands: [{ id: "brand-existing", name: original }] });
    await seedGearCatalog(allowed(existing).deps);

    assert.equal(existing.brands.filter((brand) => normalizeBrandKey(String(brand.name)) === normalizeBrandKey(first.brand)).length, 1, "the equivalent existing brand was reused, not duplicated");
    assert.equal(existing.brands.find((brand) => brand.id === "brand-existing")?.name, original, "its display name is untouched");
    assert.ok(existing.gear.some((item) => item.brandId === "brand-existing"), "the seeded gear points at the existing brand");
});

test("existing catalog records and their admin edits are never overwritten or deleted", async (t) => {
    silence(t);
    const first = loadGearSeedData()[0];
    const edited: Row = {
        id: "gear-existing",
        name: first.name,
        brandId: "brand-existing",
        affiliateUrl: "https://admin-edited.example/affiliate",
        genderTarget: "women",
        variants: { create: [{ label: "Admin variant", gender: "women", affiliateUrl: "https://admin-edited.example/v" }] },
    };
    const fake = createFakePrisma({ gear: [edited], brands: [{ id: "brand-existing", name: first.brand }] });
    const before = JSON.stringify(edited);

    const result = await seedGearCatalog(allowed(fake).deps);

    assert.equal(result.skipped >= 1, true);
    assert.equal(JSON.stringify(fake.gear.find((item) => item.id === "gear-existing")), before, "the edited item is untouched");
    assert.ok(!fake.calls.some((call) => /update|delete|upsert/.test(call) && call !== "brand.upsert"), fake.calls.filter((call) => /update|delete/.test(call)).join(","));
});

// --- whole seed -------------------------------------------------------------------------------------------------------

test("running the whole seed repeatedly is idempotent and uses the real user id", async (t) => {
    silence(t);
    const fake = createFakePrisma();
    const { deps, guardCalls } = allowed(fake);
    const total = loadGearSeedData().length;

    await runSeed(deps);
    const afterFirst = JSON.stringify({ users: fake.users, outfits: fake.outfits, gear: fake.gear });
    await runSeed(deps);
    await runSeed(deps);

    assert.equal(JSON.stringify({ users: fake.users, outfits: fake.outfits, gear: fake.gear }), afterFirst, "no row changed on later runs");
    assert.equal(fake.users.length, 1);
    assert.equal(fake.outfits.length, 1);
    assert.equal(fake.gear.length, total);
    assert.equal(fake.outfits[0].userId, fake.users[0].id, "the outfit belongs to the real account");
    assert.ok(guardCalls.count >= 3, "the guard runs on every run");
});

test("seeding next to an existing account with a different id attaches the demo data to that account", async (t) => {
    silence(t);
    const fake = createFakePrisma({ users: [{ id: "signup-created-uuid", email: SEED_USER_EMAIL, passwordHash: "salt:theirs" }] });

    await runSeed(allowed(fake).deps);

    assert.equal(fake.outfits[0].userId, "signup-created-uuid", "no foreign-key mismatch from an assumed id");
    assert.equal(fake.users[0].passwordHash, "salt:theirs");
});

// --- structure: no hard-coded credentials, ids or overwrite paths ----------------------------------------------------------

test("seed sources contain no hard-coded credentials, fixed ids or overwrite paths", () => {
    const files = ["prisma/seed.ts", "prisma/seeds/user.seed.ts", "prisma/seeds/outfit.seed.ts", "prisma/seeds/gear.seed.ts", "prisma/seeds/run.ts", "prisma/seeds/context.ts"];

    for (const path of files) {
        const source = read(path);

        assert.doesNotMatch(source, /Password\d|passw0rd/i, `${path}: hard-coded password`);
        assert.doesNotMatch(source, /user-id-1|outfit-id-1/, `${path}: assumed fixed id`);
        assert.doesNotMatch(source, /ON CONFLICT|\$queryRaw|\$executeRaw/i, `${path}: raw SQL upsert`);
        assert.doesNotMatch(source, /deleteMany|\.delete\(|\.update\(|\.updateMany\(/, `${path}: update or delete`);
        // The only upsert allowed anywhere is the create-only brand upsert in the gear seed.
        const upserts = source.match(/\.upsert\(/g)?.length ?? 0;
        assert.equal(upserts, path === "prisma/seeds/gear.seed.ts" ? 1 : 0, `${path}: unexpected upsert`);
    }

    assert.match(read("prisma/seeds/gear.seed.ts"), /prisma\.brand\.upsert\(\{\s*where: \{ normalizedName: identity\.normalizedName \},\s*update: \{\},\s*create: identity,/, "brands are create-only and keyed by the shared identity");
});

test("seed modules stay compatible with Node's TypeScript stripping", () => {
    const files = ["prisma/seed.ts", "prisma/seeds/user.seed.ts", "prisma/seeds/outfit.seed.ts", "prisma/seeds/gear.seed.ts", "prisma/seeds/run.ts", "prisma/seeds/context.ts", "prisma/seeds/safety.ts", "prisma/seeds/check.ts", "scripts/checkSeedTarget.ts", "lib/auth/password.ts", "lib/auth/logSafe.ts"];

    for (const path of files) {
        const source = read(path);

        assert.doesNotMatch(source, /^\s*(export\s+)?(const\s+)?enum\s/m, `${path}: enum`);
        assert.doesNotMatch(source, /^\s*(export\s+)?(declare\s+)?namespace\s/m, `${path}: namespace`);
        assert.doesNotMatch(source, /constructor\s*\([^)]*\b(public|private|protected|readonly)\s/, `${path}: parameter property`);
        assert.doesNotMatch(source, /from ["']@\//, `${path}: path alias`);

        for (const [, specifier] of source.matchAll(/(?:from|import\()\s*["'](\.[^"']*)["']/g)) {
            assert.match(specifier, /\.ts$/, `${path}: relative import "${specifier}" needs an explicit .ts extension`);
        }
    }
});

test("the two empty, unused scripts are gone", () => {
    assert.equal(existsSync(`${root}scripts/resetDatabase.ts`), false);
    assert.equal(existsSync(`${root}scripts/syncCatalog.ts`), false);
});

// --- importGear ----------------------------------------------------------------------------------------------------------------

test("importGear uses the same guard, has no --force bypass, and loads the import code only after the guard", () => {
    const source = read("scripts/importGear.ts");

    assert.match(source, /await assertSafeSeedTarget\(\)/);
    assert.ok(source.indexOf("await assertSafeSeedTarget()") < source.indexOf('await import("../lib/ingestion/importGear")'), "guard before the import code");
    assert.doesNotMatch(source, /^import .*ingestion\/importGear/m, "the import library is never loaded statically");
    assert.doesNotMatch(source, /NODE_ENV/, "no weak NODE_ENV check remains");
    assert.match(source, /--force is no longer supported/);
    assert.doesNotMatch(source, /const force|!force|&& !/, "no code path honours --force");
});

// --- the real entry points, run in child processes against FAKE hosted URLs -------------------------------------------------------
// The guard rejects before any database client is created, so nothing connects anywhere. The hostnames are invented.

const FAKE_HOSTED = "postgresql://dbuser:s3cr3t-child-pw@db.exampleproject.supabase.co:5432/postgres";

function runChild(args: string[], env: Record<string, string>) {
    return spawnSync(process.execPath, args, {
        cwd: root,
        // A minimal environment: no inherited DATABASE_URL, no .env contents, nothing from the developer's shell.
        env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1", ...env } as unknown as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: 60_000,
    });
}

test("prisma/seed.ts run under node's TypeScript stripping refuses a hosted target without any database access", () => {
    const environments: Array<Record<string, string>> = [{ DATABASE_URL: FAKE_HOSTED, RUNLAYER_SEED_CONFIRM_DATABASE: "postgres", SEED_USER_PASSWORD: PASSWORD }, {}];

    for (const env of environments) {
        const result = runChild(["--experimental-strip-types", "prisma/seed.ts"], env);
        const output = `${result.stdout}${result.stderr}`;

        assert.equal(result.status, 1, output);
        assert.match(output, /Seed refused:/);
        assert.ok(!/s3cr3t|exampleproject|dbuser|supabase\.co/.test(output), "no connection details in the output");
        assert.ok(!/Database seed completed/.test(output));
    }
});

test("each seed file executed directly is also refused", () => {
    for (const file of ["user.seed.ts", "gear.seed.ts", "outfit.seed.ts"]) {
        const result = runChild(["--experimental-strip-types", `prisma/seeds/${file}`], { DATABASE_URL: FAKE_HOSTED, RUNLAYER_SEED_CONFIRM_DATABASE: "postgres", SEED_USER_PASSWORD: PASSWORD });
        const output = `${result.stdout}${result.stderr}`;

        assert.equal(result.status, 1, `${file}: ${output}`);
        assert.match(output, /Seed refused:/, file);
        assert.ok(!/s3cr3t|exampleproject|dbuser/.test(output), file);
    }
});

test("scripts/importGear.ts refuses a hosted target, and --force does not help", () => {
    for (const extra of [[], ["--force"]]) {
        const result = runChild(["--import", "tsx", "scripts/importGear.ts", ...extra], { DATABASE_URL: FAKE_HOSTED, RUNLAYER_SEED_CONFIRM_DATABASE: "postgres" });
        const output = `${result.stdout}${result.stderr}`;

        assert.equal(result.status, 1, output);
        assert.match(output, /Gear import refused:/);
        assert.ok(!/s3cr3t|exampleproject|dbuser/.test(output));
        assert.ok(!/Gear import finished/.test(output));
    }
});

test("the seed modules load cleanly under node's TypeScript stripping without creating a database client", () => {
    const result = runChild(["--experimental-strip-types", "--input-type=module", "-e", "await import('./prisma/seeds/run.ts'); await import('./prisma/seeds/check.ts'); console.log('loaded')"], {});

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /loaded/);
});
