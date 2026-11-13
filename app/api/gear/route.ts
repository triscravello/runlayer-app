// app/api/gear/route.ts
//
// Public, read-only catalog. Gear writes live under /api/admin/gear (admin-guarded, Zod-validated).
// The legacy write methods are disabled with a static 405: handlers take no arguments, so the request body is never
// read, and they never call authentication or the repository. Next.js would also answer 405 for unexported methods,
// but without an `Allow` header, and an auto-generated OPTIONS would then advertise whatever is exported.
import { NextResponse } from "next/server";
import { listGearItems } from "@/lib/db/gearRepository";

const ALLOW = "GET, HEAD, OPTIONS";

export async function GET() {
    try {
        const gear = await listGearItems();
        return NextResponse.json(gear, { status: 200 });
    } catch (error) {
        console.error("Error fetching gear:", error);
        return NextResponse.json({ error: "Failed to fetch gear" }, { status: 500 });
    }
}

function methodNotAllowed() {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: ALLOW } });
}

export function OPTIONS() {
    return new Response(null, { status: 204, headers: { Allow: ALLOW } });
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
