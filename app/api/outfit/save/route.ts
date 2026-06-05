// app/api/outfit/save/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { listSavedOutfitsByUserId, saveOutfit, deleteSavedOutfitById } from "@/services/savedOutfitServerService";

export const GET = withAuth(async (_request: NextRequest, _context, user) => {
    const outfits = await listSavedOutfitsByUserId(user.id);
    return NextResponse.json(outfits);
});

export const POST = withAuth(async (request: NextRequest, _context, user) => {
    const body = await request.json();
    const { recommendationId, name, description, type, isFavorite, gearItemIds } = body;
    const savedOutfit = await saveOutfit({
        userId: user.id,
        recommendationId,
        name,
        description,
        type,
        isFavorite,
        gearItemIds,
    });

    return NextResponse.json(savedOutfit, { status: 201 });
})

export const DELETE = withAuth(async (request: NextRequest, _context, user) => {
    const { searchParams } = new URL(request.url);
    const outfitId = searchParams.get("outfitId");

    if (!outfitId) {
        return NextResponse.json({ error: "Missing outfitId" }, { status: 400 });
    }

    const result = await deleteSavedOutfitById(user.id, outfitId);
    return NextResponse.json({ deletedCount: result.count });
})