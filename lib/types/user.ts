// lib/types/user.ts
export interface User {
    id: string;
    email: string;
    passwordHash: string;
    createdAt: string;
    updatedAt: string;
};

export type ToleranceLevel = "low" | "medium" | "high";
export type TerrainPreference = "road" | "trail" | "mixed";
export type BudgetSensitivity = "low" | "medium" | "high";

export interface UserProfile {
    id: string;
    userId: string;
    location?: string | null;
    heightCm?: number | null;
    weightLbs?: number | null;
    bodyType?: string | null;
    heatSensitivity?: string | null;
    heatTolerance?: ToleranceLevel | string | null;
    coldTolerance?: ToleranceLevel | string | null;
    chafeProne: boolean;
    stylePreference?: string | null;
    budgetLevel?: string | null;
    budgetSensitivity: BudgetSensitivity | string | null;
    preferredFit?: string | null;
    terrainPreference?: TerrainPreference | string | null;
    preferredBrands: string[];
    avoidedBrands: string[];
    createdAt: string;
    updatedAt: string;
}

export type UserProfilePayload = {
    location?: string | null;
    heightCm?: number;
    weightLbs?: number;
    bodyType?: string;
    heatSensitivity: string;
    heatTolerance?: ToleranceLevel | string;
    coldTolerance?: ToleranceLevel | string;
    chafeProne: boolean;
    stylePreference: string;
    budgetLevel: string;
    budgetSensitivity?: BudgetSensitivity | string;
    preferredFit: string;
    terrainPreference?: TerrainPreference | string;
    preferredBrands?: string[];
    avoidedBrands?: string[];
}