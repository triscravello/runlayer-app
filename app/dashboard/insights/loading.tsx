import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

export default function RecommendationInsightsLoading() {
    return (
        <main className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
            <div className="mx-auto max-w-6xl space-y-6" aria-busy="true" aria-live="polite">
                <section className="space-y-3">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-9 w-80 max-w-full" />
                    <Skeleton className="h-5 w-full max-w-3xl" />
                </section>
                <div className="grid gap-6 xl:grid-cols-2">
                    {["preferences", "patterns", "brands", "weather"].map((section) => (
                        <Card key={section} className="border-slate-200 bg-white shadow-sm">
                            <CardHeader>
                                <Skeleton className="h-6 w-48" />
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {[1, 2, 3].map((item) => (
                                    <div key={item} className="rounded-2xl border bg-slate-50 p-4">
                                        <Skeleton className="h-5 w-36" />
                                        <Skeleton className="mt-3 h-4 w-full" />
                                        <Skeleton className="mt-2 h-4 w-2/3" />
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        </main>
    );
}