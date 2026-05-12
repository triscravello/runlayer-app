// app/api/gear/route.ts
import { NextResponse } from "next/server";
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

export async function POST(request: Request) {
    try {
        const data = await request.json();
        const newGear = await createGearItem(data);

        return NextResponse.json(newGear, { status: 201 });
    } catch (error) {
        console.error("Error creating gear:", error);
        return NextResponse.json({ error: "Failed to create gear" }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { id } = await request.json();
        await deleteGearItem(id);

        return NextResponse.json({ message: "Gear deleted successfully" }, { status: 200 });
    } catch (error) {
        console.error("Error deleting gear:", error);
        return NextResponse.json({ error: "Failed to delete gear" }, { status: 500 });
    }
};

export async function PUT(request: Request) {
    try {
        const data = await request.json();
        const updatedGear = await updateGearItem(data);

        return NextResponse.json(updatedGear, { status: 200 });
    } catch (error) {
        console.error("Error updating gear:", error);
        return NextResponse.json({ error: "Failed to update gear" }, { status: 500 });
    }
};

export async function PATCH(request: Request) {
    try {
        const data = await request.json();
        const updatedGear = await updateGearItem(data);

        return NextResponse.json(updatedGear, { status: 200 });
    } catch (error) {
        console.error("Error patching gear:", error);
        return NextResponse.json({ error: "Failed to patch gear" }, { status: 500 });
    }
};