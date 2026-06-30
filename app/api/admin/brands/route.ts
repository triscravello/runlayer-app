import { NextResponse, type NextRequest } from "next/server";
import { withAdmin } from "@/lib/auth/api";
import { parseJsonBody } from "@/lib/http/validation";
import { createBrand, listBrands } from "@/lib/db/brandRepository";
import { createBrandSchema } from "@/lib/validation/adminBrand";

export const GET = withAdmin(async () => {
    return NextResponse.json(await listBrands());
});

export const POST = withAdmin(async (request: NextRequest) => {
    const body = await parseJsonBody(request, createBrandSchema);
    const created = await createBrand(body);
    return NextResponse.json(created, { status: 201 });
});