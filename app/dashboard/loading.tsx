import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

export default function DashboardLoading() {
    return (
        <main className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="space-y-3">
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-5 w-full max-w-2xl" />
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                    {[1, 2, 3].map((item) => (
                        <Card key={item} className="space-y-4 p-6">
                            <Skeleton className="h-5 w-24" />
                            <Skeleton className="h-12 w-28" />
                            <Skeleton className="h-4 w-full" />
                        </Card>
                    ))}
                </div>
                <Skeleton className="h-80 rounded-2xl" />
            </div>
        </main>
    );
}