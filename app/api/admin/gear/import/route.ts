import { NextResponse, type NextRequest } from "next/server";
import { withAdmin } from "@/lib/auth/api";
import { BadRequestError } from "@/lib/http/apiErrors";
import { importGear } from "@/lib/ingestion/importGear";
import { bulkUpsertGearItems } from "@/services/gearService";
import { importGearItemsSchema } from "@/lib/validation/adminGear";

async function parseImportPayload(request: NextRequest) {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
        return importGearItemsSchema.parse(await request.json());
    }

    if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        const file = form.get("file");

        if (!(file instanceof File)) {
            throw new BadRequestError("Missing file");
        }

        try {
            return importGearItemsSchema.parse(JSON.parse(await file.text()));
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new BadRequestError("Uploaded file must contain at valid JSON");
            }

            throw error;
        }
    }

    return null;
}

export const POST = withAdmin(async (request: NextRequest) => {
    const payload = await parseImportPayload(request);

    if (!payload) {
        return NextResponse.json(await importGear());
    }

    return NextResponse.json(await bulkUpsertGearItems(payload));
})