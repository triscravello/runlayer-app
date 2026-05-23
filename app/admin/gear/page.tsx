import { ArrowUpRight, Boxes, CheckCircle2, Download, PackagePlus, Sparkles, TrendingUp, UploadCloud } from "lucide-react";
import { GearEditor } from "@/components/admin/gear/GearEditor";
import { GearFilters } from "@/components/admin/gear/GearFilters";
import { GearImportForm } from "@/components/admin/gear/GearImportForm";
import { GearTable } from "@/components/admin/gear/GearTable";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { getGear } from "@/services/gearService";

const stats = [
  { label: "Total Gear Items", value: "4,286", trend: "+6.2%", icon: Boxes },
  { label: "Recommendation Ready", value: "3,914", trend: "+4.1%", icon: CheckCircle2 },
  { label: "Active Brands", value: "127", trend: "+9 new", icon: Sparkles },
  { label: "Imports This Week", value: "42", trend: "+11 today", icon: UploadCloud },
];

export default async function AdminGearPage() {
  const items = await getGear();

  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <header className="sticky top-0 z-30 rounded-2xl border border-zinc-800/80 bg-zinc-900/75 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Gear Catalog</h1>
              <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                Manage inventory, recommendation metadata, ingestion workflows, and AI scoring readiness.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="border-zinc-700 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800">
                <PackagePlus className="size-4" /> Add Gear <span className="text-xs text-zinc-500">⌘N</span>
              </Button>
              <Button variant="outline" className="border-zinc-700 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800">
                <UploadCloud className="size-4" /> Import Catalog <span className="text-xs text-zinc-500">⌘I</span>
              </Button>
              <Button className="bg-gradient-to-r from-zinc-100 to-zinc-300 text-zinc-900 hover:from-white hover:to-zinc-200">
                <Download className="size-4" /> Export JSON <span className="text-xs text-zinc-700">⌘E</span>
              </Button>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.label} className="overflow-hidden rounded-2xl border-zinc-800/80 bg-zinc-900/70 shadow-lg shadow-black/15 transition hover:-translate-y-0.5 hover:border-zinc-700">
              <CardHeader>
                <CardDescription className="flex items-center justify-between text-zinc-400">
                  {stat.label}
                  <stat.icon className="size-4 text-zinc-500" />
                </CardDescription>
                <CardTitle className="text-3xl font-semibold">{stat.value}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="flex items-center gap-1 text-xs text-emerald-400"><TrendingUp className="size-3.5" /> {stat.trend} vs last week</p>
                <div className="grid h-8 grid-cols-10 items-end gap-1">
                  {[18, 30, 24, 50, 35, 62, 45, 71, 64, 80].map((bar, i) => (
                    <div key={i} className="rounded-sm bg-gradient-to-t from-zinc-600 to-zinc-300/90" style={{ height: `${bar}%` }} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <GearFilters />

        <section className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <Card className="rounded-2xl border-zinc-800/80 bg-zinc-900/70">
            <CardHeader className="border-b border-zinc-800/80">
              <CardTitle className="text-lg">Inventory Workspace</CardTitle>
              <CardDescription className="text-zinc-400">Enterprise table optimized for 10k+ catalog items with recommendation status intelligence.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <GearTable items={items} />
            </CardContent>
          </Card>
          <GearEditor />
        </section>

        <GearImportForm />

        <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/65 p-6 shadow-lg shadow-black/10">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Recommendation Diagnostics</h2>
              <p className="text-sm text-zinc-400">AI recommendation infrastructure is operational.</p>
            </div>
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">System Healthy</Badge>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {["Metadata completeness", "Engine health", "Scoring coverage"].map((name, idx) => (
              <Card key={name} className="rounded-xl border-zinc-800 bg-zinc-950/60">
                <CardHeader>
                  <CardDescription>{name}</CardDescription>
                  <CardTitle>{["93%", "98.7%", "88%"][idx]}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-2 rounded-full bg-zinc-800">
                    <div className="h-2 rounded-full bg-gradient-to-r from-zinc-200 to-zinc-400" style={{ width: ["93%", "98%", "88%"][idx] }} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="rounded-xl border-zinc-800 bg-zinc-950/60">
              <CardHeader>
                <CardTitle className="text-base">Low-confidence recommendations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-zinc-300">
                {[
                  "Trail shoes / Winter Mud (41 items)",
                  "Compression tops / Extreme Heat (27 items)",
                  "Rain shells / Urban Running (19 items)",
                ].map((item) => (
                  <div key={item} className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2">
                    <span>{item}</span><ArrowUpRight className="size-4 text-zinc-500" />
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="rounded-xl border-zinc-800 bg-zinc-950/60">
              <CardHeader><CardTitle className="text-base">Readiness heatmap preview</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: 35 }).map((_, i) => (
                  <div key={i} className={`h-7 rounded ${i % 5 === 0 ? "bg-amber-500/50" : i % 7 === 0 ? "bg-zinc-500/60" : "bg-emerald-500/60"}`} />
                ))}
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}