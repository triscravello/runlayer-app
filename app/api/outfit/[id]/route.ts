import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/auth/api";
import { parseJsonBody } from "@/lib/http/validation";
import { parseOutfitId, parseUpdateOutfitRequest } from "@/lib/validation/outfit";
import { deleteSavedOutfitById, getSavedOutfitById, OutfitValidationError, updateSavedOutfit } from "@/services/savedOutfitServerService";

type OutfitRouteContext = {
    params: Promise<{ id: string }>;
};

const INVALID_ID = { error: "Invalid outfit id." } as const;

export const GET = withAuth<OutfitRouteContext>(async (_request: NextRequest, { params }, user) => {
    const id = parseOutfitId((await params).id);
    if (!id) return NextResponse.json(INVALID_ID, { status: 400 });

    const outfit = await getSavedOutfitById(user.id, id);

    if (!outfit) {
        return NextResponse.json({ error: "Saved kit not found" }, { status: 404 });
    }

    return NextResponse.json(outfit);
});

export const PUT = withAuth<OutfitRouteContext>(async (request: NextRequest, { params }, user) => {
    const id = parseOutfitId((await params).id);
    if (!id) return NextResponse.json(INVALID_ID, { status: 400 });

    try {
        // Malformed JSON becomes a controlled 400 (BadRequestError); a null/array/invalid body is rejected below.
        const parsed = parseUpdateOutfitRequest(await parseJsonBody(request, z.unknown()));

        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }

        const { name, description, kitType, isFavorite, gearItemIds } = parsed.data;
        // Ownership is enforced inside the transaction with the authenticated user's id.
        const outfit = await updateSavedOutfit({
            userId: user.id,
            outfitId: id,
            name,
            description,
            type: kitType,
            isFavorite,
            gearItemIds,
        });

        if (!outfit) {
            return NextResponse.json({ error: "Saved kit not found" }, { status: 404 });
        }

        return NextResponse.json(outfit);
    } catch (error) {
        if (error instanceof OutfitValidationError) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }

        throw error;
    }
});

export const DELETE = withAuth<OutfitRouteContext>(async (_request: NextRequest, { params }, user) => {
    const id = parseOutfitId((await params).id);
    if (!id) return NextResponse.json(INVALID_ID, { status: 400 });

    const result = await deleteSavedOutfitById(user.id, id);
    return NextResponse.json({ deletedCount: result.count });
});
