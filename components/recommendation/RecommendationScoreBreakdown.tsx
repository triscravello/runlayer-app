import { Badge } from "../ui/Badge";
import type { RecommendationScoreBreakdown as ScoreBreakdown } from "@/lib/engine/types/recommendationEngine";

const breakdownRows: Array<{ key: keyof ScoreBreakdown; label: string }> = [
    { key: "weather", label: "Weather Match" },
    { key: "intensity", label: "Workout Match" },
    { key: "terrain", label: "Terrain Match" },
    { key: "seasonality", label: "Seasonality" },
    { key: "brandAffinity", label: "Brand Affinity" },
    { key: "brandPenalty", label: "Brand Penalty" },
    { key: "budget", label: "Budget Fit" },
    { key: "temperatureTolerance", label: "Temperature Tolerance" },
    { key: "rotationAdjustment", label: "Rotation Bonus" },
];

function formatScore(value: number) {
    return `${value > 0 ? "+" : ""}${value}`;
}

export type RecommendationScoreBreakdownProps = {
    totalScore: number;
    breakdown: ScoreBreakdown;
};

export function RecommendationScoreBreakdown({ totalScore, breakdown }: RecommendationScoreBreakdownProps) {
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Recommendation score breakdown">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-950">Overall Score</h3>
                <Badge className="rounded-full bg-emerald-600 px-3 py-1 text-white">{totalScore}</Badge>
            </div>
            <dl className="space-y-2 text-sm">
                {breakdownRows.map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-3">
                        <dt className="min-w-0 flex-1 text-slate-600">
                            <span>{label}</span>
                            <span className="mx-2 text-slate-300" aria-hidden="true">........</span>
                        </dt>
                        <dd className={breakdown[key] >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-red-600"}>
                            {formatScore(breakdown[key])}
                        </dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}