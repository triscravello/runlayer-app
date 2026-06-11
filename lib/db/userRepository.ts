import { prisma } from "../prisma";

type BodyTypeValue = "SLIM" | "ATHLETIC" | "BROAD" | "PLUS";
type BudgetLevelValue = "BUDGET" | "MID" | "PREMIUM";

type ToleranceValue = "low" | "medium" | "high";
type TerrainPreferenceValue = "road" | "trail" | "mixed";
type BudgetSensitivityValue = "low" | "medium" | "high";

export type UpsertUserProfileInput = {
    userId: string;
    heightCm?: number | null;
    location?: string | null;
    weightLbs?: number | null;
    bodyType?: BodyTypeValue | null;
    heatSensitivity?: string | null;
    heatTolerance?: ToleranceValue | string | null;
    coldTolerance?: ToleranceValue | string | null;
    chafeProne?: boolean | null;
    stylePreference?: string | null;
    budgetLevel?: BudgetLevelValue | null;
    budgetSensitivity?: BudgetSensitivityValue | string | null;
    preferredFit?: string | null;
    terrainPreference?: TerrainPreferenceValue | string | null;
    preferredBrands?: string[] | null;
    avoidedBrands?: string[] | null;
}

function normalizeBrandList(brands?: string[] | null) {
    if (!brands) return;
    return [...new Set(brands.map((brand) => brand.trimEnd()).filter(Boolean))];
}

export async function getUserProfile(userId: string) {
    return prisma.userProfile.findUnique({
        where: {
            userId,
        },
    });
}

export async function upsertUserProfile(input: UpsertUserProfileInput) {
    const profileData = {
        location: input.location == null ? input.location : input.location.trim() || null,
        heightCm: input.heightCm,
        weightLbs: input.weightLbs,
        bodyType: input.bodyType,
        heatSensitivity: input.heatSensitivity,
        heatTolerance: input.heatTolerance,
        coldTolerance: input.coldTolerance,
        chafeProne: input.chafeProne ?? false,
        stylePreference: input.stylePreference,
        budgetLevel: input.budgetLevel,
        budgetSensitivity: input.budgetSensitivity,
        preferredFit: input.preferredFit,
        terrainPreference: input.terrainPreference,
        preferredBrands: normalizeBrandList(input.preferredBrands),
        avoidedBrands: normalizeBrandList(input.avoidedBrands),
    };

    return prisma.userProfile.upsert({
        where: {
            userId: input.userId,
        },
        update: profileData,
        create: {
            userId: input.userId,
            ...profileData,
        },
    });
}

export async function getUserPreferences(userId: string) {
    return getUserProfile(userId);
}

export async function updateUserPreferences(input: UpsertUserProfileInput) {
    return upsertUserProfile(input);
}

export async function getOnboardingState(userId: string) {
    const profile = await getUserProfile(userId);

    return {
        userId,
        hasProfile: Boolean(profile),
        isComplete: Boolean(profile?.heightCm && profile?.weightLbs && profile?.bodyType),
    };
}

export async function getFitnessProfile(userId: string) {
    const profile = await getUserProfile(userId);

    if (!profile) return null;

    return {
        userId: profile.userId,
        heightCm: profile.heightCm,
        weightLbs: profile.weightLbs,
        bodyType: profile.bodyType,
        preferredFit: profile.preferredFit,
        heatSensitivity: profile.heatSensitivity,
        heatTolerance: profile.heatTolerance,
        coldTolerance: profile.coldTolerance,
        chafeProne: profile.chafeProne,
        terrainPreference: profile.terrainPreference,
    };
}

export async function getUserSettings(userId: string) {
    const profile = await getUserProfile(userId);

    if (!profile) return null;

    return {
        userId: profile.userId,
        stylePreference: profile.stylePreference,
        budgetLevel: profile.budgetLevel,
        budgetSensitivity: profile.budgetSensitivity,
        preferredFit: profile.preferredFit,
        preferredBrands: profile.preferredBrands,
        avoidedBrands: profile.avoidedBrands,
    };
}