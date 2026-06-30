import { prisma } from "@/lib/prisma";

export type BrandRow = Awaited<ReturnType<typeof listBrands>>[number];

type CreateBrandInput = {
    name: string;
    tier?: string | null;
    style?: string | null;
};

export async function listBrands() {
    return prisma.brand.findMany({
        orderBy: { name: "asc" },
    });
}

export async function createBrand(input: CreateBrandInput) {
    const name = input.name.trim();

    return prisma.brand.upsert({
        where: { name },
        update: {
            tier: input.tier?.trim() || undefined,
            style: input.style?.trim() || undefined,
        },
        create: {
            name,
            tier: input.tier?.trim() || null,
            style: input.style?.trim() || null,
        },
    });
}