// app/api/outfit/save/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/auth/api";
import { parseJsonBody } from "@/lib/http/validation";
import { parseCreateOutfitRequest, parseOutfitId } from "@/lib/validation/outfit";
import { listSavedOutfitsByUserId, saveOutfit, deleteSavedOutfitById, OutfitValidationError } from "@/services/savedOutfitServerService";

export const GET = withAuth(async (_request: NextRequest, _context, user) => {
    const outfits = await listSavedOutfitsByUserId(user.id);
    return NextResponse.json(outfits);
});

export const POST = withAuth(async (request: NextRequest, _context, user) => {
    try {
        // Malformed JSON becomes a controlled 400 (BadRequestError); a null/array/invalid body is rejected below.
        const parsed = parseCreateOutfitRequest(await parseJsonBody(request, z.unknown()));

        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }

        const { recommendationId, name, description, kitType, isFavorite, gearItemIds } = parsed.data;
        // The owner is always the authenticated session user, never anything from the request body.
        const savedOutfit = await saveOutfit({
            userId: user.id,
            recommendationId,
            name,
            description,
            type: kitType,
            isFavorite,
            gearItemIds,
        });

        return NextResponse.json(savedOutfit, { status: 201 });
    } catch (error) {
        if (error instanceof OutfitValidationError) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }

        throw error;
    }
})

export const DELETE = withAuth(async (request: NextRequest, _context, user) => {
    const { searchParams } = new URL(request.url);
    const outfitId = parseOutfitId(searchParams.get("outfitId"));

    if (!outfitId) {
        return NextResponse.json({ error: "Missing outfitId" }, { status: 400 });
    }

    const result = await deleteSavedOutfitById(user.id, outfitId);
    return NextResponse.json({ deletedCount: result.count });
})
