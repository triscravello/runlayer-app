import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { UserInsightsData } from "@/lib/db/analyticsRepository";

export function RecommendationPatterns({ patterns, totals }: { patterns: UserInsightsData["patterns"]; totals: UserInsightsData["totals"] }) {
    return (
        <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
                <CardTitle className="text-xl text-slate-950">Recommendation patterns</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border bg-slate-50 p-4"><div className="text-2xl font-semibold">{totals.recommendations}</div><div className="text-sm text-muted-foreground">Recommendations</div></div>
                    <div className="rounded-2xl border bg-slate-50 p-4"><div className="text-2xl font-semibold">{totals.savedKits}</div><div className="text-sm text-muted-foreground">Saved Kits</div></div>
                    <div className="rounded-2xl border bg-slate-50 p-4"><div className="text-2xl font-semibold">{totals.feedback}</div><div className="text-sm text-muted-foreground">Feedback Entries</div></div>
                </div>
                {patterns.length ? patterns.map((pattern) => (
                    <div key={pattern.name} className="flex items-center justify-between rounded-2xl border px-4 py-3 text-sm">
                        <span className="font-medium text-slate-800">{pattern.name}</span>
                        <span className="text-muted-foreground">{pattern.count} recommendation{pattern.count === 1 ? "" : "s"}</span>
                    </div>
                )) : <p className="text-sm text-muted-foreground">Workout patterns will appear after your recommendation inputs include workout types.</p>}
            </CardContent>
        </Card>
    );
}