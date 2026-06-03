import { CloudRain, Snowflake, Sun } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { PlatformAnalyticsData } from "@/lib/db/analyticsRepository";

export function WeatherAnalytics({ weather }: { weather: PlatformAnalyticsData["weather"] }) {
    const buckets = [
        { label: "Cold Weather Recommendations", value: weather.coldWeatherRecommendations, icon: Snowflake },
        { label: "Hot Weather Recommendations", value: weather.hotWeatherRecommendations, icon: Sun },
        { label: "Rain Recommendations", value: weather.rainRecommendations, icon: CloudRain },
    ];

    return (
        <section className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
            <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader><CardTitle className="text-lg text-slate-950">Most Common Conditions</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                    {weather.mostCommonConditions.length ? weather.mostCommonConditions.map((condition) => (
                        <div key={condition.name} className="flex items-center justify-between rounded-2xl border bg-slate-50 px-4 py-3 text-sm">
                            <span className="font-medium text-slate-800">{condition.name}</span>
                            <span className="text-muted-foreground">{condition.count.toLocaleString()}</span>
                        </div>
                    )) : <p className="text-sm text-muted-foreground">No weather snapshots are associated with recommendation history yet.</p>}
                </CardContent>
            </Card>
            <div className="grid gap-4 md:grid-cols-3">
                {buckets.map(({ label, value, icon: Icon }) => (
                    <Card key={label} className="border-slate-200 bg-white shadow-sm">
                        <CardHeader>
                            <span className="mb-3 flex size-10 items-center rounded-xl bg-orange-50 text-orange-700"><Icon className="size-5" /></span>
                            <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
                            <div className="text-3xl font-semibold text-slate-950">{value.toLocaleString()}</div>
                        </CardHeader>
                    </Card>
                ))}
            </div>
        </section>
    );
}