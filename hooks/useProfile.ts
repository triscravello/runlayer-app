"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserProfile, UserProfilePayload } from "@/lib/types/user";
import { userService } from "@/services/userService";

type UseProfileResult = {
    profile: UserProfile | null;
    isLoading: boolean;
    isSaving: boolean;
    error: string;
    successMessage: string;
    saveProfile: (payload: UserProfilePayload) => Promise<UserProfile | null>;
};

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
}

export function useProfile(userId?: string): UseProfileResult {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");

    useEffect(() => {
        if (!userId) {
            return;
        }

        const activeUserId = userId;
        const controller = new AbortController();

        async function loadProfile() {
            setIsLoading(true);
            setError("");
            setSuccessMessage("");

            try {
                const nextProfile = await userService.getProfile(activeUserId, {
                    signal: controller.signal,
                });

                setProfile(nextProfile);
            } catch (err) {
                if (!isAbortError(err)) {
                    setError(getErrorMessage(err, "Unable to load profile."));
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            }
        }

        loadProfile();

        return () => controller.abort();
    }, [userId]);

    const saveProfile = useCallback(
        async (payload: UserProfilePayload) => {
            if (!userId) {
                setError("Please log in before saving your profile.");
                return null;
            }

            setIsSaving(true);
            setError("");
            setSuccessMessage("");

            try {
                const nextProfile = await userService.updateProfile(userId, payload);
                setProfile(nextProfile);
                setSuccessMessage("Profile saved successfully.");
                return nextProfile;
            } catch (err) {
                setError(getErrorMessage(err, "Unable to save profile."));
                return null;
            } finally {
                setIsSaving(false);
            }
        },
        [userId],
    );

    return {
        profile: userId ? profile: null, 
        isLoading,
        isSaving,
        error,
        successMessage,
        saveProfile,
    };
}
