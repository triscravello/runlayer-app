import { NextResponse } from "next/server";
import { importGear } from "@/lib/ingestion/importGear";
import { bulkUpsertGearItems } from "@/services/gearService";

export async function POST(request: Request) {
    const contentType = request.headers.get("content-type") || "";
    try {
        if (contentType.includes("application/json")) {
            const payload = await request.json();
            if (!Array.isArray(payload)) return NextResponse.json({ error: "Expected array payload" }, { status: 400 });
            const validationErrors = payload.flatMap((item, index) => (!item.category ? [{ row: index + 1, field: "category", message: "Invalid category" }] : []));
            if (validationErrors.length) return NextResponse.json({ errors: validationErrors }, { status: 400 });
            return NextResponse.json(await bulkUpsertGearItems(payload));
        }
        
        if (contentType.includes("multipart/form-data")) {
            const form = await request.formData();
            const file = form.get("file");
            if (!(file instanceof File)) return NextResponse.json({ error: "Missing file "}, { status: 400 });
            const text= await file.text();
            const payload = JSON.parse(text);
            return NextResponse.json(await bulkUpsertGearItems(payload));
        }

        return NextResponse.json(await importGear());
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed." }, { status: 400 });
    }
}