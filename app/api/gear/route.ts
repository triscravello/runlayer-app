// app/api/gear/route.ts
//
// Public, read-only catalog. Gear writes live under /api/admin/gear (admin-guarded, Zod-validated).
// The legacy write methods are disabled with a static 405: handlers take no arguments, so the request body is never
// read, and they never call authentication or the repository. Next.js would also answer 405 for unexported methods,
// but without an `Allow` header, and an auto-generated OPTIONS would then advertise whatever is exported.
import { NextResponse } from "next/server";
import { listGearItems } from "@/lib/db/gearRepository";
import { toPublicGearItem } from "@/lib/gear/publicGear";

const ALLOW = "GET, HEAD, OPTIONS";

export async function GET() {
    try {
        // Read-time containment only: unsafe stored affiliate links are removed from the public JSON, never from the database. The
        // response is shaped explicitly (allow-list), so internal columns such as `version` never reach it.
        const gear = (await listGearItems()).map(toPublicGearItem);
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
