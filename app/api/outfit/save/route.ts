// app/api/outfit/save/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/api";
import { listSavedOutfitsByUserId, saveOutfit, deleteSavedOutfitById, OutfitValidationError } from "@/services/savedOutfitServerService";
import { z } from "zod";

export const GET = withAuth(async (_request: NextRequest, _context, user) => {
    const outfits = await listSavedOutfitsByUserId(user.id);
    return NextResponse.json(outfits);
});

const saveOutfitSchema = z.object({
    recommendationId: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    type: z.string().optional().nullable(),
    isFavorite: z.boolean().optional().nullable(),
    gearItemIds: z.array(z.string()).min(1, "Missing gear items.").optional(),
});

export const POST = withAuth(async (request: NextRequest, _context, user) => {
    try {
        const body = saveOutfitSchema.parse(await request.json());
        const { recommendationId, name, description, category, type, isFavorite, gearItemIds } = body;
        const savedOutfit = await saveOutfit({
            userId: user.id,
            recommendationId,
            name,
            description,
            category,
            type,
            isFavorite,
            gearItemIds,
        });

        return NextResponse.json(savedOutfit, { status: 201 });
    } catch (error) {
        if (error instanceof OutfitValidationError) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }

        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid save outfit payload." }, { status: 400 });
        }

        throw error;
    }
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