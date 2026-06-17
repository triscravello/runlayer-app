// lib/types/user.ts
export interface User {
    id: string;
    email: string;
    passwordHash: string;
    createdAt: string;
    updatedAt: string;
};

import type { UserProfilePayload } from "../validation/profileSchema";

export type { UserProfilePayload };
export type ToleranceLevel = UserProfilePayload["heatTolerance"];
export type TerrainPreference = UserProfilePayload["terrainPreference"];
export type BudgetSensitivity = UserProfilePayload["budgetSensitivity"];
export type BodyType = NonNullable<UserProfilePayload["bodyType"]>;
export type PreferredFit = UserProfilePayload["preferredFit"];
export type GenderPreference = NonNullable<UserProfilePayload["genderPreference"]>;
export type StylePreference = UserProfilePayload["stylePreference"];
export type BudgetLevel = UserProfilePayload["budgetLevel"];

export interface UserProfile {
    id: string;
    userId: string;
    location?: string | null;
    heightCm?: number | null;
    weightLbs?: number | null;
    bodyType?: string | null;
    genderPreference?: GenderPreference | string | null;
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