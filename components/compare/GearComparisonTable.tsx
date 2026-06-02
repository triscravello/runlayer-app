import { ComparisonMetricRow } from "./ComparisonMetricRow";
import { Button } from "../ui/Button";
import type { ScoredRecommendationItem } from "@/lib/engine/types/recommendationEngine";

export type GearComparisonTableProps = { items: ScoredRecommendationItem[] };

type NumericMetric = keyof ScoredRecommendationItem["scoreBreakdown"] | "totalScore";

const metricRows: Array<{ key: NumericMetric; label: string }> = [
    { key: "totalScore", label: "Total score" },
    { key: "weather", label: "Weather score" },
    { key: "intensity", label: "Intensity score" },
    { key: "terrain", label: "Terrain score" },
    { key: "seasonality", label: "Season score" },
    { key: "budget", label: "Budget score" },
    { key: "brandAffinity", label: "Brand affinity" },
    { key: "brandPenalty", label: "Brand penalty" },
    { key: "temperatureTolerance", label: "Temp tolerance" },
];

function getMetricValue(item: ScoredRecommendationItem, key: NumericMetric) {
    return key === "totalScore" ? item.totalScore : item.scoreBreakdown[key];
}

function getBestValue(items: ScoredRecommendationItem[], key: NumericMetric) {
    return Math.max(...items.map((item) => getMetricValue(item, key)));
}

export function GearComparisonTable({ items }: GearComparisonTableProps) {
    if (items.length < 2) {
        return <p className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-800">Select at least two gear items to compare structured scores.</p>;
    }

    return (
        <div className="overflow-x-auto rounded-3xl border bg-white shadow-sm">
            <table className="w-full border-collapse">
                <caption className="sr-only">Side-by-side gear comparison</caption>
                <thead>
                    <tr className="border-b bg-slate-50">
                        <th className="sticky left-0 z-10 min-w-36 bg-slate-50 px-4 py-4 text-left text-sm font-semibold text-slate-700">Metric</th>
                        {items.map(({ item }) => (
                            <th key={item.id} className="min-w-56 px-4 py-4 text-left align-top">
                                <div className="space-y-2">
                                    <div>
                                        <div className="text-base font-semibold text-slate-950">{item.name}</div>
                                        <div className="text-sm font-normal text-muted-foreground">{item.brandName ?? item.brandId ?? "Brand unknown"}</div>
                                    </div>
                                    <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">Select for outfit</Button>
                                </div>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {metricRows.map((row) => {
                        const best = getBestValue(items, row.key);
                        return (
                            <ComparisonMetricRow
                                key={row.key}
                                label={row.label}
                                values={items.map((scored) => ({ itemId: scored.item.id, value: getMetricValue(scored, row.key), isBest: getMetricValue(scored, row.key) === best }))}
                            />
                        );
                    })}
                    <ComparisonMetricRow label="Price" values={items.map(({ item }) => ({ itemId: item.id, value: item.priceRange }))} />
                    <ComparisonMetricRow label="Category" values={items.map(({ item }) => ({ itemId: item.id, value: item.category }))} />
                    <ComparisonMetricRow label="Tags" values={items.map(({ item }) => ({ itemId: item.id, value: item.tags.slice(0, 5) }))} />
                    <ComparisonMetricRow label="Recommended for" values={items.map((scored) => ({ itemId: scored.item.id, value: scored.reasons[0] ?? "Solid all-around option" }))} />
                </tbody>
            </table>
        </div>
    );
}