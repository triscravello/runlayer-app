import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import type { PlatformAnalyticsData } from "@/lib/db/analyticsRepository";

export function RecommendationAnalytics({ workouts }: { workouts: PlatformAnalyticsData["workouts"] }) {
    const rows = [
        { label: "Easy Run Recommendations", value: workouts.easyRunRecommendations },
        { label: "Tempo Recommendations", value: workouts.tempoRecommendations },
        { label: "Race-Day Recommendations", value: workouts.raceDayRecommendations },
        { label: "Recovery Recommendations", value: workouts.recoveryRecommendations },
    ];

    return (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {rows.map((row) => (
                <Card key={row.label} className="border-slate-200 bg-white shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-sm text-muted-foreground">{row.label}</CardTitle>
                        <div className="text-3xl font-semibold text-slate-950">{row.value.toLocaleString()}</div>
                    </CardHeader>
                </Card>
            ))}
        </section>
    );
}