import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

export default function RecommendationLoading() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-background to-background px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-end">
          <div className="space-y-5">
            <Skeleton className="h-8 w-48 rounded-full" />
            <div className="space-y-3">
              <Skeleton className="h-12 w-full max-w-2xl" />
              <Skeleton className="h-12 w-full max-w-xl" />
              <Skeleton className="h-7 w-full max-w-3xl" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-7 w-32 rounded-full" />
              <Skeleton className="h-7 w-28 rounded-full" />
              <Skeleton className="h-7 w-44 rounded-full" />
            </div>
          </div>
          <Card className="space-y-4 border-emerald-100 bg-white/90 p-6 shadow-sm">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
          </Card>
        </section>

        <section className="grid gap-5" aria-label="Loading ranked gear recommendations">
          {[1, 2, 3].map((item) => (
            <Card key={item} className="overflow-hidden border-slate-200 bg-white shadow-sm">
              <div className="grid gap-0 lg:grid-cols-[220px_1fr]">
                <div className="space-y-6 bg-slate-950 p-6">
                  <Skeleton className="h-5 w-20 bg-slate-800" />
                  <Skeleton className="h-14 w-24 bg-slate-800" />
                  <Skeleton className="h-7 w-36 rounded-full bg-slate-800" />
                </div>
                <div className="grid gap-6 p-6 md:p-7 xl:grid-cols-[1fr_380px]">
                  <div className="space-y-5">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-8 w-72" />
                    <Skeleton className="h-6 w-full max-w-2xl" />
                    <div className="grid gap-3 md:grid-cols-3">
                      <Skeleton className="h-28 rounded-2xl" />
                      <Skeleton className="h-28 rounded-2xl" />
                      <Skeleton className="h-28 rounded-2xl" />
                    </div>
                  </div>
                  <Skeleton className="h-44 rounded-3xl" />
                </div>
              </div>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
}