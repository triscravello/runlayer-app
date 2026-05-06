// lib/types/user.ts
export interface User {
    id: string;
    email: string;
    passwordHash: string;
    createdAt: string;
    updatedAt: string;
};

export interface UserProfile {
    id: string;
    userId: string;
    heightCm?: number | null;
    weightLbs?: number | null;
    bodyType?: string | null;
    heatSensitivity?: string | null;
    chafeProne: boolean;
    stylePreference?: string | null;
    budgetLevel?: string | null;
    preferredFit?: string | null;
    createdAt: string;
    updatedAt: string;
}

export type UserProfilePayload = {
    heightCm?: number;
    weightLbs?: number;
    bodyType?: string;
    heatSensitivity: string;
    chafeProne: boolean;
    stylePreference: string;
    budgetLevel: string;
    preferredFit: string;
}