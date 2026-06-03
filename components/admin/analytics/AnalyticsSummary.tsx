import { Activity, CalendarDays, Save, ThumbsUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { PlatformAnalyticsData } from "@/lib/db/analyticsRepository";

function formatPercent(value: number) {
    return `${Math.round(value * 100)}%`;
}

export function AnalyticsSummary({ summary, engineVersions }: { summary: PlatformAnalyticsData["summary"]; engineVersions: PlatformAnalyticsData["engineVersions"] }) {
    const metrics = [
        { label: "Total Recommendations Generated", value: summary.totalRecommendations.toLocaleString(), icon: Activity },
        { label: "Recommendations This Week", value: summary.recommendationsThisWeek.toLocaleString(), icon: CalendarDays },
        { label: "Recommendations This Month", value: summary.recommendationsThisMonth.toLocaleString(), icon: CalendarDays },
        { label: "Saved Kits Created", value: summary.savedKitsCreated.toLocaleString(), icon: Save },
        { label: "Feedback Submission Rate", value: formatPercent(summary.feedbackSubmissionRate), icon: ThumbsUp },
        { label: "Helpful Feedback %", value: formatPercent(summary.helpfulFeedbackPercent), icon: ThumbsUp },
    ];

    return (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {metrics.map(({ label, value, icon: Icon }) => (
                <Card key={label} className="border-slate-200 bg-white shadow-sm">
                    <CardHeader className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                            <span className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><Icon className="size-4"/></span>
                        </div>
                        <div className="text-3xl font-semibold text-slate-950">{value}</div>
                    </CardHeader>
                </Card>
            ))}
            <Card className="border-emerald-100 bg-emerald-50/70 shadow-sm xl:col-span-3">
                <CardHeader>
                    <CardTitle className="text-base text-emerald-950">Recommendation engine versions</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2 text-sm text-emerald-900">
                    {engineVersions.length ? engineVersions.map((version) => (
                        <span key={version.name} className="rounded-full border border-emerald-200 bg-white px-3 py-1">
                            Engine v${version.name}: {version.count.toLocaleString()} recommendations
                        </span>
                    )) : <span>No versioned recommendations yet.</span>}
                </CardContent>
            </Card>
        </section>
    )
}