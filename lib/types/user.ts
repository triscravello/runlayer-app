// lib/types/user.ts
export interface User {
    id: number;
    name: string;
    email: string;
    password: string;
    createdAt: Date;
    updatedAt: Date;
};

export interface UserProfile {
    id: number;
    userId: number;
    bodyType: string;
    heatSensitivity: string;
    chafeProne: boolean;
    stylePreference: string;
    budgetLevel: string;
    preferredFit: string;
    createdAt: Date;
    updatedAt: Date;
}