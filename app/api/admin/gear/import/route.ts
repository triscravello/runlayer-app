import { NextResponse, type NextRequest } from "next/server";
import { withAdmin } from "@/lib/auth/api";
import { BadRequestError } from "@/lib/http/apiErrors";
import { listBrands } from "@/lib/db/brandRepository";
import { parseAdminGearImportFile } from "@/lib/ingestion/parseAdminGearImport";
import { validateBulkGearImportRows } from "@/lib/validation/adminGearImport";
import { bulkUpsertGearItems } from "@/services/gearService";

export const POST = withAdmin(async (request: NextRequest) => {
    const form = await request.formData();
    const mode = form.get("mode");
    const file = form.get("file");

    if (mode !== "dry-run" && mode !== "commit") {
        throw new BadRequestError("Import mode must be dry-run or commit");
    }

    if (!(file instanceof File)) {
        throw new BadRequestError("Missing import file");
    }

    const rawRows = await parseAdminGearImportFile(file);
    const brands = await listBrands();
    const validation = validateBulkGearImportRows(rawRows, brands);

    if (mode === "dry-run") {
        return NextResponse.json({ mode, ...validation, validItems: undefined });
    }

    if (validation.validRows === 0) {
        return NextResponse.json({ mode, ...validation, validItems: undefined, imported: { total: 0, inserted: 0, updated: 0, failed: [] }, status: 400 });
    }

    const imported = await bulkUpsertGearItems(validation.validItems);

    return NextResponse.json({ mode, ...validation, validItems: undefined, imported });
})