import { NextResponse } from "next/server";
import { updateGearItem } from "@/services/gearService";
import { deleteGearItem } from "@/lib/db/gearRepository";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const {id} = await params;
    const body = await request.json();
    return NextResponse.json(await updateGearItem(id, body));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    const {id} = await params;
    await deleteGearItem(id);
    return NextResponse.json({ success: true });
}
