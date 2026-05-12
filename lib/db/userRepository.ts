import { prisma } from "../prisma";

type BodyTypeValue = "SLIM" | "ATHLETIC" | "BROAD" | "PLUS";
type BudgetLevelValue = "BUDGET" | "MID" | "PREMIUM";

export type UpsertUserProfileInput = {
    userId: string;
    heightCm?: number | null;
    weightLbs?: number | null;
    bodyType?: BodyTypeValue | null;
    heatSensitivity?: string | null;
    chafeProne?: boolean | null;
    stylePreference?: string | null;
    budgetLevel?: BudgetLevelValue | null;
    preferredFit?: string | null;
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
        heightCm: input.heightCm,
        weightLbs: input.weightLbs,
        bodyType: input.bodyType,
        heatSensitivity: input.heatSensitivity,
        chafeProne: input.chafeProne ?? false,
        stylePreference: input.stylePreference,
        budgetLeve: input.budgetLevel,
        preferredFit: input.preferredFit,
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
        chafeProne: profile.chafeProne,
    };
}

export async function getUserSettings(userId: string) {
    const profile = await getUserProfile(userId);

    if (!profile) return null;

    return {
        userId: profile.userId,
        stylePreference: profile.stylePreference,
        budgetLevel: profile.budgetLevel,
        preferredFit: profile.preferredFit,
    };
}