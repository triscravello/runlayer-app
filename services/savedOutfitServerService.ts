import {
    deleteSavedOutfitById,
    getSavedOutfitById as getSavedOutfitRecord,
    listSavedOutfitsByUserId as listSavedOutfitRecords,
    OutfitValidationError,
    saveOutfit as saveOutfitRecord,
    updateSavedOutfit as updateSavedOutfitRecord,
    type OutfitTransactionRunner,
    type SaveOutfitInput,
    type SavedKitType,
    type UpdateSavedOutfitInput,
} from "@/lib/db/outfitRepository";
import { toClientSavedOutfit } from "@/lib/gear/clientGear";

// The client-facing boundary for saved outfits. The repository returns whole Prisma rows (including each item's full gear row); every
// outfit that leaves through here has its nested gear objects rebuilt from an allow-list, so internal columns such as the gear
// `version` counter never reach the client. Queries, transactions and ownership checks are the repository's, unchanged.
export { deleteSavedOutfitById, OutfitValidationError, type SaveOutfitInput, type UpdateSavedOutfitInput, type SavedKitType };

export async function listSavedOutfitsByUserId(userId: string) {
    return (await listSavedOutfitRecords(userId)).map(toClientSavedOutfit);
}

export async function getSavedOutfitById(userId: string, outfitId: string) {
    const outfit = await getSavedOutfitRecord(userId, outfitId);
    return outfit ? toClientSavedOutfit(outfit) : outfit;
}

export async function saveOutfit(input: SaveOutfitInput, client?: OutfitTransactionRunner) {
    return toClientSavedOutfit(await (client ? saveOutfitRecord(input, client) : saveOutfitRecord(input)));
}

export async function updateSavedOutfit(input: UpdateSavedOutfitInput, client?: OutfitTransactionRunner) {
    const outfit = await (client ? updateSavedOutfitRecord(input, client) : updateSavedOutfitRecord(input));
    return outfit ? toClientSavedOutfit(outfit) : outfit;
}
