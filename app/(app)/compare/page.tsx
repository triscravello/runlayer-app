import { GearComparisonClient } from "@/components/compare/GearComparisonClient";
import { listGearRecommendationCandidates } from "@/lib/db/gearRepository";
import { rankGearRecommendations } from "@/lib/engine/recommendationEngine";

export const dynamic = "force-dynamic";

type ComparePageProps = {
  searchParams?: Promise<{ gear?: string }>;
}

export default async function ComparePage({ searchParams }: ComparePageProps) {
  const params = await searchParams;
  const initialSelectedIds = params?.gear?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
  const gearItems = await listGearRecommendationCandidates();
  const scoredItems = rankGearRecommendations(
    { weather: "hot", intensity: "tempo", terrain: "road", category: "all" },
    gearItems,
    { budgetRange: "mid", budgetSensitivity: "medium", heatTolerance: "low", terrainPreference: "road" },
  ).sort((a, b) => {
    const aSelected = initialSelectedIds.includes(a.item.id);
    const bSelected = initialSelectedIds.includes(b.item.id);
    return Number(bSelected) - Number(aSelected);
  }).slice(0, 12);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Gear comparison</p>
        <h1 className="text-3xl font-semibold text-slate-950">Compare gear side-by-side</h1>
        <p className="max-w-3xl text-muted-foreground">
          Select two to four items and review score breakdowns, attributes, and recommendation reasons from the engine.
        </p>
      </div>
      <GearComparisonClient scoredItems={scoredItems} initialSelectedIds={initialSelectedIds} />
    </div>
  );
}