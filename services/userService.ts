import { prisma } from "@/lib/prisma";
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
};

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
    budgetLevel: input.budgetLevel,
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