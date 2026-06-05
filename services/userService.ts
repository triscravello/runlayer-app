import type { UserProfile } from "@/lib/types/user";
import { readJsonResponse, type ServiceRequestOptions } from "./apiResponse";

export const userService = {
    async getProfile(_userId: string, options: ServiceRequestOptions = {}): Promise<UserProfile | null> {
        const response = await fetch("/api/profile", {
            credentials: "include",
            signal: options.signal,
        });

        if (response.status === 404) return null;
        return readJsonResponse<UserProfile>(response, "Unable to load profile.");
    }, 

    async updateProfile(_userId: string | undefined, payload: UserProfilePayload): Promise<UserProfile> {
        const response = await fetch("/api/profile", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "include",
            body: JSON.stringify(payload),
        });

        return readJsonResponse<UserProfile>(response, "Unable to save profile.");
    },
};

export type UserProfilePayload = Partial<Omit<UserProfile, "id" | "userId" | "createdAt" | "updatedAt">>;