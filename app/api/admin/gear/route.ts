import { NextResponse } from "next/server";
import { createGearItem, getGear } from "@/services/gearService";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
    await requireAdmin();
    return NextResponse.json(await getGear());
}

export async function POST(request: Request) {
    try {
        await requireAdmin();
        
        const body = await request.json();
        const created = await createGearItem(body);
        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 400 });
    }
}