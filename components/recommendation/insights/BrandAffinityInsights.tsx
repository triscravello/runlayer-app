import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { UserInsightsData } from "@/lib/db/analyticsRepository";

export function BrandAffinityInsights({ brands }: { brands: UserInsightsData["brandAffinities"] }) {
    return (
        <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader>
                <CardTitle className="text-xl text-slate-950">Preferred brands</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {brands.length ? brands.map((brand) => (
                    <article key={brand.name} className="rounded-2xl border bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="font-semibold text-slate-950">{brand.name}</h3>
                            <span className="rounded-full bg-white px-3 py-1 text-sm text-muted-foreground">{brand.count} matches</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{brand.explanation}</p>
                    </article>
                )) : <p className="text-sm text-muted-foreground">Save kits or generate recommendations to build brand affinity insights.</p>}
            </CardContent>
        </Card>
    );
}