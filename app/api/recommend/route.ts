import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { filterByCategory, rankGearList, type GearItem, type UserInput } from "@/lib/engine/recommendationEngine";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as UserInput;
        const gearItems = (await prisma.gearItem.findMany()) as GearItem[];

        const filteredGear = filterByCategory(gearItems, body.category);
        const ranked = rankGearList(body, filteredGear).slice(0, 5);

        return NextResponse.json({ recommendations: ranked });
    } catch (error) {
        console.error(error);

        return NextResponse.json(
            { error: "Failed to generate recommendation" },
            { status: 500 }
        );
    }
}