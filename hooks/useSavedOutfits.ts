"use client";

import { useCallback, useEffect, useState } from "react";
import {
    savedOutfitService,
    type SavedOutfit,
    type SavedOutfitRecord,
    type SaveOutfitInput,
} from "@/services/savedOutfitService";

type UseSavedOutfitsResult = {
    savedOutfits: SavedOutfit[];
    savedOutfit: SavedOutfitRecord | null;
    isLoading: boolean;
    isSaving: boolean;
    error: string;
    successMessage: string;
    refreshSavedOutfits: () => Promise<SavedOutfit[]>;
    saveOutfit: (input: SaveOutfitInput) => Promise<SavedOutfitRecord | null>;
}

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
}

export function useSavedOutfits(userId?: string): UseSavedOutfitsResult {
    const [savedOutfits, setSavedOutfits] = useState<SavedOutfit[]>([]);
    const [savedOutfit, setSavedOutfit] = useState<SavedOutfitRecord | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");

    const refreshSavedOutfits = useCallback(async () => {
        if (!userId) {
            setSavedOutfits([]);
            return [];
        }

        setIsLoading(true);
        setError("");
        setSuccessMessage("");

        try {
            const outfits = await savedOutfitService.listSavedOutfits(userId);
            setSavedOutfits(outfits);
            return outfits;
        } catch (err) {
            setError(getErrorMessage(err, "Unable to load saved outfits."));
            return [];
        } finally {
            setIsLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        if (!userId) {
            return;
        }

        const activeUserId = userId;
        const controller = new AbortController();

        async function loadSavedOutfits() {
            setIsLoading(true);
            setError("");
            setSuccessMessage("");

            try {
                const outfits = await savedOutfitService.listSavedOutfits(activeUserId, {
                    signal: controller.signal,
                });
                setSavedOutfits(outfits);
            } catch (err) {
                if (!isAbortError(err)) {
                    setError(getErrorMessage(err, "Unable to load saved outfits."));
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            }
        }

        loadSavedOutfits();

        return () => controller.abort();
    }, [userId]);

    const saveOutfit = useCallback(async (input: SaveOutfitInput) => {
        setIsSaving(true);
        setError("");
        setSuccessMessage("");

        try {
            const nextSavedOutfit = await savedOutfitService.saveOutfit(input);
            setSavedOutfit(nextSavedOutfit);
            setSuccessMessage("Outfit saved successfully.");
            return nextSavedOutfit;
        } catch (err) {
            setError(getErrorMessage(err, "Unable to save outfit."));
            return null;
        } finally {
            setIsSaving(false);
        }
    }, []);

    return {
        savedOutfits: userId ? savedOutfits : [],
        savedOutfit,
        isLoading,
        isSaving,
        error,
        successMessage,
        refreshSavedOutfits,
        saveOutfit,
    };
}