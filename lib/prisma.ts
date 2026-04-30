// lib/prisma.ts
import * as Prisma from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: Prisma.PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new Prisma.PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}