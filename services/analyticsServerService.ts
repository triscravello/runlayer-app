import { getPlatformAnalytics, getUserRecommendationInsights } from "@/lib/db/analyticsRepository";

export async function getAdminAnalyticsDashboard() {
    return getPlatformAnalytics();
}

export async function getRecommendationInsights(userId: string) {
    return getUserRecommendationInsights(userId);
}