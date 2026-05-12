import type { UserProfile, UserProfilePayload } from "@/lib/types/user";
import { readJsonResponse, type ServiceRequestOptions } from "./apiResponse";

export const userService = {
    async getProfile(userId: string, options: ServiceRequestOptions = {}): Promise<UserProfile | null> {
        const response = await fetch(`/api/profile?userId=${encodeURIComponent(userId)}`, {
            credentials: "include",
            signal: options.signal,
        });

        if (response.status === 404) return null;

        return readJsonResponse<UserProfile>(response, "Unable to load profile.");
    }, 

    async updateProfile(userId: string, payload: UserProfilePayload): Promise<UserProfile> {
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

        return readJsonResponse<UserProfile>(response, "Unable to save profile.");
    }
};