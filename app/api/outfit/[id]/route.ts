import { NextResponse } from "next/server";
import { deleteSavedOutfitById, getSavedOutfitById, updateSavedOutfit } from "@/services/savedOutfitServerService";

type OutfitRouteContext = {
    params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: OutfitRouteContext) {
    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");

        if (!userId) {
            return NextResponse.json({ error: "Missing userId" }, { status: 400 });
        }

        const outfit = await getSavedOutfitById(userId, id);

        if (!outfit) {
            return NextResponse.json({ error: "Saved kit not found" }, { status: 404 });
        }

        return NextResponse.json(outfit);
    } catch (error) {
        console.error("Error fetching saved kit:", error);
        return NextResponse.json({ error: "Failed to fetch saved kit." }, { status: 500 });
    }
}

export async function PUT(request: Request, { params }: OutfitRouteContext) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { userId, name, description, type, isFavorite, gearItemIds } = body;

        if (!userId) {
            return NextResponse.json({ error: "Missing userId" }, { status: 400 });
        }

        const outfit = await updateSavedOutfit({
            userId,
            outfitId: id,
            name,
            description,
            type,
            isFavorite,
            gearItemIds,
        });

        if (!outfit) {
            return NextResponse.json({ error: "Saved kit not found."}, { status: 404 });
        }

        return NextResponse.json(outfit);
    } catch (error) {
        console.error("Error updating saved kit:", error);
        return NextResponse.json({ error: "Failed to update saved kit" }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: OutfitRouteContext) {
    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");

        if (!userId) {
            return NextResponse.json({ error: "Missing userId" }, { status: 400 });
        }

        const result = await deleteSavedOutfitById(userId, id);
        return NextResponse.json({ deletedCount: result.count });
    } catch (error) {
        console.error("Error deleting saved kit:", error);
        return NextResponse.json({ error: "Failed to delete saved kit"}, { status: 500 });
    }
}