import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth/api";
import { parseGearUpdateRequest } from "@/lib/http/adminGearUpdate";
import { mapAdminGearWriteError } from "@/lib/http/adminGearErrors";
import { updateGearItem } from "@/services/gearService";
import { deleteGearItem } from "@/lib/db/gearRepository";

type GearItemRouteContext = { params: Promise<{ id: string }> };

export const PATCH = withAdmin<GearItemRouteContext>(async (request: NextRequest, { params }) => {
    const { id } = await params;
    const body = await parseGearUpdateRequest(request, id);
    try {
        return NextResponse.json(await updateGearItem(id, body));
    } catch (error) {
        mapAdminGearWriteError(error, { conflict: true });
    }
})

export const DELETE = withAdmin<GearItemRouteContext>(async (_request: NextRequest, { params }) => {
    const { id } = await params;
    try {
        await deleteGearItem(id);
    } catch (error) {
        mapAdminGearWriteError(error);
    }
    return NextResponse.json({ success: true });
});
