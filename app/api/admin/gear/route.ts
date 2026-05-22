import { NextResponse } from "next/server";
import { createGearItem, getGear } from "@/services/gearService";

export async function GET() {
    return NextResponse.json(await getGear());
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const created = await createGearItem(body);
        return NextResponse.json(created, { status: 201 });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 400 });
    }
}