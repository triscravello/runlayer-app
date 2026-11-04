import assert from "node:assert/strict";
import test from "node:test";
import { checkSeedScenarios, mergeEnv, parseDotenv } from "./check";

const PASSWORD = "k9#Vq2-Lm7!xR4tZ";

const hostedDotEnv = `# hosted development database
DATABASE_URL="postgresql://dbuser:s3cr3t-check-pw@db.exampleproject.supabase.co:5432/postgres"
BETTER_AUTH_SECRET=not-printed
`;

const goodLocal = `DATABASE_URL=postgresql://dev:pw@localhost:5432/runlayer_dev
RUNLAYER_SEED_CONFIRM_DATABASE=runlayer_dev
SEED_USER_PASSWORD=${PASSWORD}
`;

function joined(result: { lines: string[] }) {
    return result.lines.join("\n");
}

test("the default workflow against a hosted .env is rejected", () => {
    const result = checkSeedScenarios({ processEnv: {}, dotEnv: hostedDotEnv });

    assert.match(result.lines[1], /npm run db:seed \(uses \.env\): REJECTED \[hosted_database\]/);
    assert.equal(result.ok, false);
});

test("a correct .env.seed.local is accepted even when .env is hosted", () => {
    const result = checkSeedScenarios({ processEnv: {}, dotEnv: hostedDotEnv, seedLocalEnv: goodLocal });

    assert.match(result.lines[1], /REJECTED \[hosted_database\]/, "plain db:seed stays rejected");
    assert.match(result.lines[2], /db:seed:local .*ACCEPTED/);
    assert.equal(result.ok, true);
});

test("a missing .env.seed.local is reported as not configured", () => {
    const result = checkSeedScenarios({ processEnv: {}, dotEnv: hostedDotEnv });

    assert.match(result.lines[2], /NOT CONFIGURED/);
    assert.equal(result.ok, false);
});

test("a weak or missing seed password makes the local workflow fail without printing it", () => {
    const weak = goodLocal.replace(PASSWORD, "weakpassword");
    const missing = goodLocal.replace(`SEED_USER_PASSWORD=${PASSWORD}\n`, "");

    for (const seedLocalEnv of [weak, missing]) {
        const result = checkSeedScenarios({ processEnv: {}, seedLocalEnv });
        assert.equal(result.ok, false);
        assert.match(result.lines[2], /target accepted .* but SEED_USER_PASSWORD/);
        assert.ok(!joined(result).includes("weakpassword"));
    }
});

test("a missing confirmation or a wrong database name makes the local workflow fail", () => {
    const noConfirm = goodLocal.replace("RUNLAYER_SEED_CONFIRM_DATABASE=runlayer_dev\n", "");
    const wrongDatabase = goodLocal.replace("/runlayer_dev", "/postgres");

    assert.match(checkSeedScenarios({ processEnv: {}, seedLocalEnv: noConfirm }).lines[2], /missing_confirmation/);
    assert.match(checkSeedScenarios({ processEnv: {}, seedLocalEnv: wrongDatabase }).lines[2], /invalid_database_name/);
});

test("variables already in the environment win over both files, as they do for the real commands", () => {
    // A hosted DATABASE_URL exported in the shell would override .env.seed.local, so the check must reject it.
    const result = checkSeedScenarios({
        processEnv: { DATABASE_URL: "postgresql://dbuser:s3cr3t-check-pw@db.exampleproject.supabase.co:5432/postgres" },
        seedLocalEnv: goodLocal,
    });

    assert.match(result.lines[2], /REJECTED \[hosted_database\]/);
    assert.equal(result.ok, false);
});

test("the report never prints URLs, hosts, credentials, passwords or database names", () => {
    const scenarios = [
        checkSeedScenarios({ processEnv: {}, dotEnv: hostedDotEnv, seedLocalEnv: goodLocal }),
        checkSeedScenarios({ processEnv: {}, dotEnv: hostedDotEnv }),
        checkSeedScenarios({ processEnv: { DATABASE_URL: "postgresql://dbuser:s3cr3t-check-pw@10.1.2.3:5432/runlayer_dev" }, seedLocalEnv: goodLocal }),
    ];

    for (const result of scenarios) {
        const text = joined(result);
        for (const secret of ["s3cr3t-check-pw", "dbuser", "exampleproject", "supabase.co", PASSWORD, "10.1.2.3", "postgresql://", "runlayer_dev", "not-printed"]) {
            assert.ok(!text.includes(secret), `output leaked ${secret}`);
        }
    }
});

test("the report states that no connection is made", () => {
    assert.match(joined(checkSeedScenarios({ processEnv: {} })), /no database connection is made/);
});

test("parseDotenv handles comments, quotes, export and inline comments", () => {
    const parsed = parseDotenv(`# comment
A=1
export B="two words"
C='single'
D=value # trailing comment
E=
 F = spaced
not a line
=missing
`);

    assert.deepEqual(parsed, { A: "1", B: "two words", C: "single", D: "value", E: "", F: "spaced" });
});

test("mergeEnv lets the first layer that defines a key win", () => {
    assert.deepEqual(mergeEnv([{ A: "1", B: undefined }, undefined, { A: "2", B: "b" }, { C: "c" }]), { A: "1", B: "b", C: "c" });
});
