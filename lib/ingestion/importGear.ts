import { bulkUpsertGearItems } from "@/services/gearService";
import { mapGearItem } from "./mappers/gearMapper";
import { parseGearJsonFiles } from "./parsers/jsonGearParser";
import type { GearImportResult, RawGearItemInput } from "./types";
import { validateGearItem } from "./validators/gearValidator";

export async function importGear(): Promise<GearImportResult> {
    const rawItems = await parseGearJsonFiles();
    const validItems: RawGearItemInput[] = [];
    const failed: GearImportResult["failed"] = [];

    for (const raw of rawItems) {
        const errors = validateGearItem(raw);
        if (errors.length > 0) {
            failed.push({ name: raw.name ?? "unknown", reason: errors.join(", ") });
            continue;
        }

        validItems.push(raw);
    }

    const normalizedItems = validItems.map(mapGearItem);
    const writeResult = await bulkUpsertGearItems(normalizedItems);

    return {
        processed: rawItems.length,
        inserted: writeResult.inserted,
        updated: writeResult.updated,
        failed: [...failed, ...writeResult.failed],
    };
}