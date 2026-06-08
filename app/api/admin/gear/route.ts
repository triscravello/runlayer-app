import { NextResponse, type NextRequest } from "next/server";
import { withAdmin } from "@/lib/auth/api";
import { parseJsonBody } from "@/lib/http/validation";
import { createGearItem, getGear } from "@/services/gearService";
import { createGearItemSchema } from "@/lib/validation/adminGear";

export const GET = withAdmin(async () => {
    return NextResponse.json(await getGear());
});

export const POST = withAdmin(async (request: NextRequest) => {
    const body = await parseJsonBody(request, createGearItemSchema);
    const created = await createGearItem(body);
    return NextResponse.json(created, { status: 201 });
})