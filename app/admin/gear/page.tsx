import { Boxes, CheckCircle2, Download, PackagePlus, Sparkles, UploadCloud, type LucideIcon } from "lucide-react";
import { GearEditor } from "@/components/admin/gear/GearEditor";
import { GearFilters } from "@/components/admin/gear/GearFilters";
import { GearImportForm } from "@/components/admin/gear/GearImportForm";
import { GearTable } from "@/components/admin/gear/GearTable";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { getGear } from "@/services/gearService";
import { requireAdmin } from "@/lib/auth";

type GearItem = Awaited<ReturnType<typeof getGear>>[number];

type AdminStat = {
  key: string;
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
};

const RECOMMENDATION_SCORERS = [
  "weatherScorer",
  "intensityScorer",
  "terrainScorer",
  "seasonalScorer",
  "brandAffinityScorer",
  "rotationPenaltyScorer",
] as const;

const WEATHER_SIGNALS = ["hot", "cold", "rain", "wind"] as const;

function isRecommendationReady(item: GearItem): boolean {
  const weatherCoverage = WEATHER_SIGNALS.filter((signal) => {
    const value = item[`weather${signal.charAt(0).toUpperCase()}${signal.slice(1)}` as "weatherHot" | "weatherCold" | "weatherRain" | "weatherWind"];
    return typeof value === "number"
  }).length;

  return item.tags.length > 0 && weatherCoverage >= 2
}

function deriveStats(items: GearItem[]): AdminStat[] {
  const totalItems = items.length;
  const uniqueCategories = new Set(items.map((item) => item.category)).size;
  const uniqueBrands = new Set(items.map((item) => item.brandId)).size;
  const readyItems = items.filter(isRecommendationReady).length;
  const missingMetadata = totalItems - readyItems;
  const coveragePct = totalItems === 0 ? 0 : Math.round((readyItems / totalItems) * 100);
  const categoryCoveragePct = totalItems === 0 ? 0 : Math.round((uniqueCategories / 3) * 100);

  return [
    {
      key: "gear-total",
      label: "Catalog Inventory",
      value: totalItems.toLocaleString(),
      helper: `${uniqueBrands} active brands across ${uniqueCategories} categories`,
      icon: Boxes,
    },
    {
      key: "recommendation-ready",
      label: "Recommendation Coverage",
      value: `${coveragePct}%`,
      helper: `${readyItems.toLocaleString()} items ready for scoring modules`,
      icon: CheckCircle2,
    },
    {
      key: "scorers-online",
      label: "Scoring Pipeline",
      value: `${RECOMMENDATION_SCORERS.length} modules`,
      helper: `${WEATHER_SIGNALS.length} weather signals + intensity, terrain, and season scoring`,
      icon: Sparkles,
    },
    {
      key: "metadata-gap",
      label: "Metadata Backlog",
      value: missingMetadata.toLocaleString(),
      helper: `${categoryCoveragePct}% category coverage in current seed catalog`,
      icon: UploadCloud,
    }
  ];
}

export default async function AdminGearPage() {
  await requireAdmin();
  
  const items = await getGear();
  const stats = deriveStats(items);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-zinc-800/70 bg-zinc-900/70 p-4 shadow-sm backdrop-blur sm:p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Gear Catalog</h1>
              <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                Manage product details and recommendation metadata for the RunLayer gear catalog.
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

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.key} className="rounded-2xl border-zinc-800/70 bg-zinc-900/55 shadow-sm">
              <CardHeader className="space-y-2 p-4">
                <CardDescription className="flex items-center justify-between text-xs text-zinc-400">
                  {stat.label}
                  <stat.icon className="size-4 text-zinc-500" />
                </CardDescription>
                <CardTitle className="text-2xl font-semibold text-zinc-100">{stat.value}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-xs leading-5 text-zinc-400">{stat.helper}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <GearFilters />

        <section className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card className="min-w-0 rounded-2xl border-zinc-800/70 bg-zinc-900/60">
            <CardHeader className="border-b border-zinc-800/80">
              <CardTitle className="text-lg">Catalog items</CardTitle>
              <CardDescription className="text-zinc-400">Review gear details, metadata coverage, and update status.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <GearTable items={items} />
            </CardContent>
          </Card>
          <GearEditor item={items[0] ?? null} />
        </section>

        <GearImportForm />
      </div>
    </main>
  );
}