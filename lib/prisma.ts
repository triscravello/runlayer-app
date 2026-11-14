// lib/prisma.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Fail closed under node:test. The test launcher (scripts/runTests.mjs) loads test-support/isolation/guard.cjs, which neutralizes
// hosted database configuration before this module runs. Without it, a real client would read DATABASE_URL from `.env`. A test
// that installs its own fake on globalThis.prisma never reaches the constructor. NODE_TEST_CONTEXT is set only by `node --test`.
if (process.env.NODE_TEST_CONTEXT && !globalForPrisma.prisma && !(globalThis as { __RUNLAYER_TEST_ISOLATION__?: unknown }).__RUNLAYER_TEST_ISOLATION__) {
  throw new Error("Refusing to create a PrismaClient under node:test without the test-isolation guard. Run the tests with `npm test` (or `npm run test:integration`).");
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}