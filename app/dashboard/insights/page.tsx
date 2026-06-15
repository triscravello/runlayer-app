import Link from "next/link";

import { BrandAffinityInsights } from "@/components/recommendation/insights/BrandAffinityInsights";
import { PreferenceInsights } from "@/components/recommendation/insights/PreferenceInsights";
import { RecommendationPatterns } from "@/components/recommendation/insights/RecommendationPatterns";
import { WeatherInsights } from "@/components/recommendation/insights/WeatherInsights";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { requireAuth } from "@/lib/auth";
import type { UserInsightsData } from "@/lib/db/analyticsRepository";
import { getRecommendationInsights } from "@/services/analyticsServerService";

export const runtime = "nodejs";

type InsightsSection = "preferences" | "patterns" | "brandAffinities" | "weather";

const insightSections: Array<{
    key: InsightsSection,
    title: string;
    description: string;
}> = [
    {
        key: "preferences",
        title: "Preference signals",
        description: "Generate recommendations with tagged gear to unlock deterministic preference explanations.",
    },
    {
        key: "patterns",
        title: "Workout patterns",
        description: "Add workout type and terrain context when requesting recommendations to populate this section.",
    },
    {
        key: "brandAffinities",
        title: "Brand affinity",
        description: "Save kits or build more recommendation history to identify recurring brand signals.",
    },
    {
        key: "weather",
        title: "Weather context",
        description: "Recommendations created with weather snapshots will show temperature ranges and conditions here."
    },
];

function hasInsightData(insights: UserInsightsData) {
    return insights.preferences.length > 0
        || insights.patterns.length > 0
        || insights.brandAffinities.length > 0
        || insights.weather.length > 0;
}

function getSparseSections(insights: UserInsightsData) {
    return insightSections.filter((section) => insights[section.key].length === 0);
}

function InsightsPageShell({ children }: { children: React.ReactNode }) {
    return (
        <main className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
            <div className="mx-auto max-w-6xl space-y-6">{children}</div>
        </main>
    );
}

function InsightsHeader({ totalRecommendations }: { totalRecommendations: number }) {
    return (
        <section className="space-y-3" aria-labelledby="insights-title">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Dashboard</p>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="space-y-2">
                    <h1 id="insights-title" className="text-3xl font-semibold text-slate-950">Recommendations insights</h1>
                    <p className="max-w-3xl text-muted-foreground">
                        Deterministic insights derived from your recommendation history, saved kits, feedback, profile preferences, and weather context. Every insight explains why it exists. 
                    </p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                    <span className="block text-2xl font-semibold text-slate-950">{totalRecommendations}</span>
                    recommendation{totalRecommendations === 1 ? "" : "s"} analyzed
                </div>
            </div>
        </section>
    );
}

function InsightsEmptyState() {
    return (
        <Card className="border-dashed border-emerald-200 bg-emerald-50/60 shadow-sm">
            <CardHeader>
                <CardTitle className="text-xl text-emerald-950">No insights yet.</CardTitle>
                <CardDescription className="max-w-3xl text-emerald-900">
                    Recommendation insights appear after RunLayer has enough history to explain your preferences, patterns, brands, and weather context. 
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm text-emerald-950 sm:flex-row sm:items-center sm:justify-between">
                <p>Start with a recommendation, then save kits or submit feedback to make these insights more useful.</p>
                <Button asChild>
                    <Link href="/recommendation">Generate a recommendation</Link>
                </Button>
            </CardContent>
        </Card>
    );
}

function SparseInisightsNotice({ sections }: { sections: ReturnType<typeof getSparseSections> }) {
    if (!sections.length) return null;

    return (
        <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
                <CardTitle className="text-lg text-slate-950">Ways to improve these insights</CardTitle>
                <CardDescription>
                    Some sections need more history before RunLayer can make useful observations.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ul className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2" aria-label="Missing insight data guidance">
                    {sections.map((section) => (
                        <li key={section.key} className="rounded-2xl border bg-slate-50 p-4">
                            <span className="font-medium text-slate-800">{section.title}: </span>{section.description}
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}

export default async function RecommendationInsightsPage() {
    const user = await requireAuth();
    const insights: UserInsightsData = await getRecommendationInsights(user.id);
    const hasData = hasInsightData(insights);
    const sparseSections = hasData ? getSparseSections(insights) : [];

    return (
        <InsightsPageShell>
            <InsightsHeader totalRecommendations={insights.totals.recommendations} />

            {!hasData ? <InsightsEmptyState /> : <SparseInisightsNotice sections={sparseSections} />}

            <div className="grid gap-6 xl:grid-cols-2">
                <PreferenceInsights preferences={insights.preferences} />
                <RecommendationPatterns patterns={insights.patterns} totals={insights.totals} />
                <BrandAffinityInsights brands={insights.brandAffinities} />
                <WeatherInsights weather={insights.weather} />
            </div>
        </InsightsPageShell>
    );
}