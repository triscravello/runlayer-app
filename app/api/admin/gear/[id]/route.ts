import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth/api";
import { parseJsonBody } from "@/lib/http/validation";
import { updateGearItem } from "@/services/gearService";
import { deleteGearItem } from "@/lib/db/gearRepository";
import { updateGearItemSchema } from "@/lib/validation/adminGear";

type GearItemRouteContext = { params: Promise<{ id: string }> };

export const PATCH = withAdmin<GearItemRouteContext>(async (request: NextRequest, { params }) => {
    const { id } = await params;
    const body = await parseJsonBody(request, updateGearItemSchema);
    return NextResponse.json(await updateGearItem(id, body));
})

export const DELETE = withAdmin<GearItemRouteContext>(async (_request: NextRequest, { params }) => {
    const { id } = await params;
    await deleteGearItem(id);
    return NextResponse.json({ success: true });
});
