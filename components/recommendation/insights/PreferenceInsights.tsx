import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { UserInsightsData } from "@/lib/db/analyticsRepository";

export type PreferenceInsightsProps = {
    preferences: UserInsightsData["preferences"];
}

export function PreferenceInsights({ preferences }: PreferenceInsightsProps) {
    return (
        <Card className="border-emerald-100 bg-white shadow-sm">
            <CardHeader>
                <CardTitle className="text-xl text-slate-950">You frequently choose</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {preferences.length ? preferences.map((preference) => (
                    <article key={`${preference.label}-${preference.value}`} className="rounded-2xl border bg-emerald-50/50 p-4">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <h3 className="font-semibold text-emerald-950">{preference.label}</h3>
                            <span className="text-sm font-medium text-emerald-700">{preference.value}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-emerald-900">{preference.explanation}</p>
                    </article>
                )) : <p className="text-sm text-muted-foreground">Generate recommendations to build deterministic preference insights.</p>}
            </CardContent>
        </Card>
    );
}