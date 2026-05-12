import { readJsonResponse, type ServiceRequestOptions } from "./apiResponse";

export type SaveOutfitInput = {
    userId: string;
    recommendationId?: string;
    name?: string | null;
    isFavorite?: boolean | null;
}

export type SavedOutfit = SaveOutfitInput & {
    id: string;
    userId: string;
    recommendationId: string | null;
    name: string | null;
    isFavorite: boolean;
    createdAt: string | Date;
    recommendation?: unknown;
    OutfitItem?: unknown[];
}

export type SavedOutfitRecord = Omit<SavedOutfit, "recommendation" | "OutfitItem">;

export const savedOutfitService = {
    async listSavedOutfits(userId: string, options: ServiceRequestOptions = {}): Promise<SavedOutfit[]> {
        const response = await fetch(`api/outfit/save?userId=${encodeURIComponent(userId)}`, {
            credentials: "include",
            signal: options.signal,
        });

        return readJsonResponse<SavedOutfit[]>(response, "Unable to load saved outfits.");
    },

    async saveOutfit(input: SaveOutfitInput): Promise<SavedOutfitRecord> {
        const response = await fetch("/api/outfit/save", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify(input),
        });

        return readJsonResponse<SavedOutfitRecord>(response, "Unable to save outfits.");
    }
};