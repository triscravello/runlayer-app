import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { UserInsightsData } from "@/lib/db/analyticsRepository";

export type WeatherInsightsProps = {
    weather: UserInsightsData["weather"];
}

export function WeatherInsights({ weather }: WeatherInsightsProps) {
    return (
        <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
                <CardTitle className="text-xl text-slate-950">Most common conditions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {weather.length ? weather.map((item) => (
                    <article key={`${item.label}-${item.count}`} className="rounded-2xl border bg-orange-50/50 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="font-semibold text-orange-950">{item.label}</h3>
                            <span className="text-sm font-medium text-orange-700">{item.count} records</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-orange-900">{item.explanation}</p>
                    </article>
                )) : <p className="text-sm text-muted-foreground">Weather insights require recommendations with weather snapshots.</p>}
            </CardContent>
        </Card>
    );
}