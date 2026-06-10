import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

export default function AppLoading() {
    return (
        <main className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-background to-background px-4 py-8 md:px-8 md:py-12">
            <div className="mx-auto flex max-w-6xl flex-col gap-6">
                <div className="space-y-3">
                    <Skeleton className="h-8 w-44 rounded-full" />
                    <Skeleton className="h-12 w-full max-w-2xl" />
                    <Skeleton className="h-6 w-full max-w-3xl" />
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                    {[1, 2, 3].map((item) => (
                        <Card key={item} className="space-y-4 p-6">
                            <Skeleton className="h-6 w-28" />
                            <Skeleton className="h-20 w-full rounded-2xl" />
                            <Skeleton className="h-4 w-3/4" />
                        </Card>
                    ))}
                </div>
            </div>
        </main>
    );
}