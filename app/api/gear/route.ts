// app/api/gear/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { withAdmin } from "@/lib/auth/api";
import {
    createGearItem,
    deleteGearItem,
    listGearItems,
    updateGearItem,
} from "@/lib/db/gearRepository";

export async function GET() {
    try {
        const gear = await listGearItems();
        return NextResponse.json(gear, { status: 200 });
    } catch (error) {
        console.error("Error fetching gear:", error);
        return NextResponse.json({ error: "Failed to fetch gear" }, { status: 500 });
    }
}

export const POST = withAdmin(async (request: NextRequest) => {
    const data = await request.json();
    const newGear = await createGearItem(data);

    return NextResponse.json(newGear, { status: 201 });
});

export const DELETE = withAdmin(async (request: NextRequest) => {
    const { id } = await request.json();
    await deleteGearItem(id);

    return NextResponse.json({ message: "Gear deleted successfully" }, { status: 200 });
});

export const PUT = withAdmin(async (request: NextRequest) => {
    const data = await request.json();
    const updatedGear = await updateGearItem(data);

    return NextResponse.json(updatedGear, { status: 200 });
});

export const PATCH = withAdmin(async (request: NextRequest) => {
    const data = await request.json();
    const updatedGear = await updateGearItem(data);

    return NextResponse.json(updatedGear, { status: 200 });
});