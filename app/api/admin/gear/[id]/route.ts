import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth/api";
import { parseGearUpdateRequest, splitGearUpdateBody } from "@/lib/http/adminGearUpdate";
import { mapAdminGearWriteError } from "@/lib/http/adminGearErrors";
import { updateGearItem } from "@/services/gearService";
import { deleteGearItem } from "@/lib/db/gearRepository";

type GearItemRouteContext = { params: Promise<{ id: string }> };

export const PATCH = withAdmin<GearItemRouteContext>(async (request: NextRequest, { params }) => {
    const { id } = await params;
    const { data, options } = splitGearUpdateBody(await parseGearUpdateRequest(request, id));
    try {
        // The updated row, including its new `version`, is the response: the caller uses it as the next expectedVersion.
        return NextResponse.json(options ? await updateGearItem(id, data, options) : await updateGearItem(id, data));
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
