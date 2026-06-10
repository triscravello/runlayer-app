import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

export default function AdminLoading() {
    return (
        <main className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-100 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl space-y-6">
                <Skeleton className="h-24 rounded-2xl bg-zinc-900" />
                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {[1, 2, 3, 4].map((item) => (
                        <Card key={item} className="border-zinc-800 bg-zinc-900/70 p-6">
                            <Skeleton className="h-5 w-28 bg-zinc-800" />
                            <Skeleton className="h-10 w-20 bg-zinc-800" />
                            <Skeleton className="h-4 w-full bg-zinc-800" />
                        </Card>
                    ))}
                </section>
                <Skeleton className="h-96 rounded-2xl bg-zinc-900" />
            </div>
        </main>
    );
}