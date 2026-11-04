import type { PrismaClient } from "@prisma/client";

/**
 * Prisma-backed SessionStore (see lib/auth/session.ts). Takes the client as a parameter so the application uses
 * its shared client while a database test can supply its own.
 */
export function createPrismaSessionStore(client: Pick<PrismaClient, "user">) {
    return {
        findUserById: (id: string) =>
            client.user.findUnique({
                where: { id },
                select: {
                    id: true,
                    email: true,
                    role: true,
                    sessionVersion: true,
                    createdAt: true,
                    updatedAt: true,
                    profile: {
                        select: {
                            location: true,
                        },
                    },
                },
            }),
        // One atomic UPDATE ... WHERE id = ? AND session_version = ? with an in-database increment.
        incrementSessionVersionIfCurrent: async (id: string, expectedVersion: number) => {
            const result = await client.user.updateMany({
                where: { id, sessionVersion: expectedVersion },
                data: { sessionVersion: { increment: 1 } },
            });

            return result.count === 1;
        },
    };
}
