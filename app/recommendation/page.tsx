import { redirect } from "next/navigation";
import { RecommendationPageClient } from "@/components/recommendation/RecommendationPageClient";
import { RECOMMENDATION_ENGINE_VERSION } from "@/config/recommendationEngineVersion";
import { getSessionUser } from "@/lib/auth";
import { getUserProfile } from "@/lib/db/userRepository";

export default async function RecommendationPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  const profile = await getUserProfile(user.id);
  const clientProfile = profile ? {
    ...profile,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  } : null;

  return (
    <RecommendationPageClient
      user={{ id: user.id, location: user.location }}
      profile={clientProfile}
      engineVersion={RECOMMENDATION_ENGINE_VERSION}
    />
  );
}