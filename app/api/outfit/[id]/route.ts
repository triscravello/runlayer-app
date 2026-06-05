import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { deleteSavedOutfitById, getSavedOutfitById, updateSavedOutfit } from "@/services/savedOutfitServerService";

type OutfitRouteContext = {
    params: Promise<{ id: string }>;
};

export const GET = withAuth<OutfitRouteContext>(async (_request: NextRequest, { params }, user) => {
    const { id } = await params;
    const outfit = await getSavedOutfitById(user.id, id);

    if (!outfit) {
        return NextResponse.json({ error: "Saved kit not found" }, { status: 404 });
    }

    return NextResponse.json(outfit);
});

export const PUT = withAuth<OutfitRouteContext>(async (request: NextRequest, { params }, user) => {
    const { id } = await params;
    const body = await request.json();
    const { name, description, type, isFavorite, gearItemIds } = body;
    const outfit = await updateSavedOutfit({
        userId: user.id,
        outfitId: id,
        name,
        description,
        type,
        isFavorite,
        gearItemIds
    });

    if (!outfit) {
        return NextResponse.json({ error: "Saved kit not found" }, { status: 404 });
    }

    return NextResponse.json(outfit);
});

export const DELETE = withAuth<OutfitRouteContext>(async (_request: NextRequest, { params }, user) => {
    const { id } = await params;
    const result = await deleteSavedOutfitById(user.id, id);
    return NextResponse.json({ deletedCount: result.count });
});