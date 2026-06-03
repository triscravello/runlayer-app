import { BrandAffinityInsights } from "@/components/recommendation/insights/BrandAffinityInsights";
import { PreferenceInsights } from "@/components/recommendation/insights/PreferenceInsights";
import { RecommendationPatterns } from "@/components/recommendation/insights/RecommendationPatterns";
import { WeatherInsights } from "@/components/recommendation/insights/WeatherInsights";
import { requireAuth } from "@/lib/auth";
import { getRecommendationInsights } from "@/services/analyticsServerService";

export const runtime = "nodejs";

export default async function RecommendationInsightsPage() {
    const user = await requireAuth();
    const insights = await getRecommendationInsights(user.id);

    return (
        <main className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
            <div className="mx-auto max-w-6xl space-y-6">
                <section className="space-y-2">
                    <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Dashboard</p>
                    <h1 className="text-3xl font-semibold text-slate-950">Recommendation insights</h1>
                    <p className="max-w-3xl text-muted-foreground">
                        Deterministic insights derived from your recommendation history, saved kits, feedback, profile preferences, and weather context. Every insight explains why it exists.
                    </p>
                </section>

                <div className="grid gap-6 xl:grid-cols-2">
                    <PreferenceInsights preferences={insights.preferences} />
                    <RecommendationPatterns patterns={insights.patterns} totals={insights.totals} />
                    <BrandAffinityInsights brands={insights.brandAffinities} />
                    <WeatherInsights weather={insights.weather} />
                </div>
            </div>
        </main>
    );
}