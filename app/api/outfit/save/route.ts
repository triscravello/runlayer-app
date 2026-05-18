// app/api/outfit/save/route.ts
import { NextResponse } from "next/server";
import { listSavedOutfitsByUserId, saveOutfit, deleteSavedOutfitById } from "@/services/savedOutfitServerService";

// GET saved outfits for a user
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");

        if (!userId) {
            return NextResponse.json(
                { error: "Missing userId" },
                { status: 400 },
            );
        }

        const outfits = await listSavedOutfitsByUserId(userId);

        return NextResponse.json(outfits);
    } catch (error) {
        console.error("Error fetching outfit:", error);
        return NextResponse.json({ error: "Failed to fetch outfit" }, { status: 500 });
    }
};

// SAVE outfit
export async function POST(request: Request) {
    try {
        const body = await request.json();

        const { userId, recommendationId, name, isFavorite } = body;

        if (!userId) {
            return NextResponse.json(
                { error: "Missing userId" },
                { status: 400 },
            );
        }

        const savedOutfit = await saveOutfit({
            userId,
            recommendationId,
            name,
            isFavorite,
        });

        return NextResponse.json(savedOutfit, { status: 201 });
    } catch (error) {
        console.error("Error creating outfit:", error);
        return NextResponse.json({ error: "Failed to create outfit" }, { status: 500 });
    }
}

// DELETE saved outfit for a user
export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get("userId");
        const outfitId = searchParams.get("outfitId");

        if (!userId || !outfitId) {
            return NextResponse.json(
                { error: "Missing userId or outfitId" },
                { status: 400 },
            );
        }

        const result = await deleteSavedOutfitById(userId, outfitId);
        
        return NextResponse.json({ deletedCount: result.count });
    } catch (error) {
        console.error("Error deleting outfit:", error);
        return NextResponse.json({ error: "Failed to delete outfit" }, { status: 500 });
    }
}