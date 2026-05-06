"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserProfile, UserProfilePayload } from "@/lib/types/user";

type UseProfileResult = {
    profile: UserProfile | null;
    isLoading: boolean;
    isSaving: boolean;
    error: string;
    successMessage: string;
    saveProfile: (payload: UserProfilePayload) => Promise<UserProfile | null>;
};

async function readProfileResponse(response: Response): Promise<UserProfile> {
    const data = (await response.json()) as UserProfile | { error?: string };

    if (!response.ok) {
        throw new Error("error" in data && data.error ? data.error : "Unable to load profile.")
    }

    return data as UserProfile;
}

export function useProfile(userId?: string): UseProfileResult {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");

    useEffect(() => {
        if (!userId) return;

        const activateUserId = userId;
        const controller = new AbortController();

        async function loadProfile() {
            setIsLoading(true);
            setError("");
            setSuccessMessage("");

            try {
                const response = await fetch(`/api/profile?userId=${encodeURIComponent(activateUserId)}`, {
                    credentials: "include",
                    signal: controller.signal,
                });

                if (response.status === 404) {
                    setProfile(null);
                    return;
                }

                const nextProfile = await readProfileResponse(response);
                setProfile(nextProfile);
            } catch (err) {
                if (err instanceof DOMException && err.name === "AbortError") {
                    return;
                }

                const message = err instanceof Error ? err.message : "Unable to load profile.";
                setError(message);
            } finally {
                setIsLoading(false);
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
                const response = await fetch("/api/profile", {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        userId,
                        ...payload,
                    }),
                });

                const nextProfile = await readProfileResponse(response);
                setProfile(nextProfile);
                setSuccessMessage("Profile saved successfully.");
                return nextProfile;
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unable to save profile.";
                setError(message);
                return null;
            } finally {
                setIsSaving(false);
            }
        },
        [userId],
    );

    return {
        profile, 
        isLoading,
        isSaving,
        error,
        successMessage,
        saveProfile
    };
}
