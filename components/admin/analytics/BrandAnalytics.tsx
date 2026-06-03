import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { PlatformAnalyticsData, CountByName } from "@/lib/db/analyticsRepository";

function CountList({ rows, emptyMessage }: { rows: CountByName[]; emptyMessage: string }) {
    if (!rows.length) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>

    const max = Math.max(...rows.map((row) => row.count), 1);
    return (
        <div className="space-y-3">
            {rows.map((row) => (
                <div key={row.name} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-4 text-sm">
                        <span className="font-medium text-slate-800">{row.name}</span>
                        <span className="text-muted-foreground">{row.count.toLocaleString()}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.max(8, (row.count / max) * 100)}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function BrandAnalytics({ brands }: { brands: PlatformAnalyticsData["brands"] }) {
    const groups = [
        { title: "Most Recommended Brands", rows: brands.mostRecommended, emptyMessage: "No recommendation brand data yet." },
        { title: "Most Saved Brands", rows: brands.mostSaved, emptyMessage: "No saved-kit brand data yet." },
        { title: "Most Compared Brands", rows: brands.mostCompared, emptyMessage: "Comparison events are not tracked yet." },
        { title: "Most Viewed Brands", rows: brands.mostViewed, emptyMessage: "Brand view events are not tracked yet." },
    ];

    return (
        <section className="grid gap-4 lg:grid-cols-2">
            {groups.map((group) => (
                <Card key={group.title} className="border-slate-200 bg-white shadow-sm">
                    <CardHeader><CardTitle className="text-lg text-slate-950">{group.title}</CardTitle></CardHeader>
                    <CardContent><CountList rows={group.rows} emptyMessage={group.emptyMessage} /></CardContent>
                </Card>
            ))}
        </section>
    )
}