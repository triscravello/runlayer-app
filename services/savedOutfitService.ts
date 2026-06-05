import { readJsonResponse, type ServiceRequestOptions } from "./apiResponse";

export type SavedKitType = "race_day" | "training" | "custom";

export type SaveOutfitInput = {
    userId?: string;
    recommendationId?: string;
    name?: string | null;
    description?: string | null;
    type?: SavedKitType;
    isFavorite?: boolean | null;
    gearItemIds?: string[];
}

export type SavedOutfit = SaveOutfitInput & {
    id: string;
    userId: string;
    recommendationId: string | null;
    name: string | null;
    description: string | null;
    type: SavedKitType;
    isFavorite: boolean;
    createdAt: string | Date;
    updatedAt: string | Date;
    recommendation?: unknown;
    OutfitItem?: unknown[];
}

export type SavedOutfitRecord = Omit<SavedOutfit, "recommendation" | "OutfitItem">;

export type UpdateSavedOutfitInput = Partial<Omit<SaveOutfitInput, "userId">> & {
    userId?: string;
    outfitId: string;
}

export type DeleteSavedOutfitInput = {
    userId?: string;
    outfitId: string;
}

export const savedOutfitService = {
    async listSavedOutfits(_userId: string, options: ServiceRequestOptions = {}): Promise<SavedOutfit[]> {
        const response = await fetch("/api/outfit/save", {
            credentials: "include",
            signal: options.signal,
        });

        return readJsonResponse<SavedOutfit[]>(response, "Unable to load saved outfits.");
    },

    async saveOutfit(input: SaveOutfitInput): Promise<SavedOutfitRecord> {
        const payload = {
            recommendationId: input.recommendationId,
            name: input.name,
            description: input.description,
            type: input.type,
            isFavorite: input.isFavorite,
            gearItemIds: input.gearItemIds
        }
        const response = await fetch("/api/outfit/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
        });

        return readJsonResponse<SavedOutfitRecord>(response, "Unable to save outfits.");
    },

    async updateSavedOutfit(input: UpdateSavedOutfitInput): Promise<SavedOutfit> {
        const { outfitId } = input;
        const payload = {
            recommendationId: input.recommendationId,
            name: input.name,
            description: input.description,
            type: input.type,
            isFavorite: input.isFavorite,
            gearItemIds: input.gearItemIds,
        };
        const response = await fetch(`/api/outfit/${encodeURIComponent(outfitId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
        });

        return readJsonResponse<SavedOutfit>(response, "Unable to update saved kit.");
    },

    async deleteSavedOutfit(input: DeleteSavedOutfitInput): Promise<{ deletedCount: number }> {
        const params = new URLSearchParams({ outfitId: input.outfitId });
        const response = await fetch(`/api/outfit/save?${params.toString()}`, {
            method: "DELETE",
            credentials: "include",
        });

        return readJsonResponse<{ deletedCount: number }>(response, "Unable to delete saved outfit.");
    },
};