"use client";

import { useCallback, useState } from "react";
import {
    recommendationService,
    type CreateRecommendationInput,
    type GearRecommendationResult,
    type RecommendationRecord,
    type UserInput,
} from "@/services/recommendationService";

type UseRecommendationResult = {
    recommendations: GearRecommendationResult | null;
    savedRecommendation: RecommendationRecord | null;
    isLoading: boolean;
    isSaving: boolean;
    error: string;
    successMessage: string;
    fetchRecommendations: (input: UserInput) => Promise<GearRecommendationResult | null>;
    refreshRecommendations: (input: UserInput) => Promise<GearRecommendationResult | null>;
    saveRecommendation: (input: CreateRecommendationInput) => Promise<RecommendationRecord | null>;
};

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

export function useRecommendation(): UseRecommendationResult {
    const [recommendations, setRecommendations] = useState<GearRecommendationResult | null>(null);
    const [savedRecommendation, setSavedRecommendation] = useState<RecommendationRecord | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");

    const fetchRecommendations = useCallback(async (input: UserInput) => {
        setIsLoading(true);
        setError("");
        setSuccessMessage("");

        try {
            const nextRecommendations = await recommendationService.generateRecommendations(input);
            setRecommendations(nextRecommendations);
            return nextRecommendations;
        } catch (err) {
            setError(getErrorMessage(err, "Unable to fetch recommendations."));
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    const saveRecommendation = useCallback(async (input: CreateRecommendationInput) => {
        setIsSaving(true);
        setError("");
        setSuccessMessage("");

        try {
            const saved = await recommendationService.saveRecommendation(input);
            setSavedRecommendation(saved);
            setSuccessMessage("Recommendation saved successfully.");
            return saved;
        } catch (err) {
            setError(getErrorMessage(err, "Unable to save recommendation."));
            return null;
        } finally {
            setIsSaving(false);
        }
    }, []);

    return {
        recommendations,
        savedRecommendation,
        isLoading,
        isSaving,
        error,
        successMessage,
        fetchRecommendations,
        refreshRecommendations: fetchRecommendations,
        saveRecommendation,
    };
}