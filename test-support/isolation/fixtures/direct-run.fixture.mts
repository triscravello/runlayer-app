// A node:test file run WITHOUT the isolation preload, the way `npx tsx --test <file>` would. Importing the real lib/prisma.ts
// must be refused. Run only by isolation.regression.test.ts, in a child process whose DATABASE_URL is a reserved .invalid name.
import assert from "node:assert/strict";
import test from "node:test";

test("lib/prisma refuses to build a client under node:test without the guard", async () => {
    await assert.rejects(import("../../../lib/prisma.ts"), /test-isolation guard/);
});
