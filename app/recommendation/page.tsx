import { RecommendationFeedbackControls } from "@/components/recommendation/RecommendationFeedbackControls";
import { RecommendationScoreBreakdown } from "@/components/recommendation/RecommendationScoreBreakdown";
import { Badge } from "@/components/ui/Badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import {
  Award,
  CheckCircle2,
  ChevronRight,
  CloudSnow,
  Gauge,
  Layers,
  Sparkles,
} from "lucide-react";

type RecommendationSignal = {
  label: string;
  value: string;
};

type RankedGearRecommendation = {
  rank: number;
  recommendationId?: string;
  name: string;
  brand: string;
  category: string;
  score: number;
  breakdown: {
    weather: number;
    intensity: number;
    terrain: number;
    seasonality: number;
    brandAffinity: number;
    rotationAdjustment: number;
  };
  matchLabel: string;
  description: string;
  why: string;
  signals: RecommendationSignal[];
  tags: string[];
};

const recommendationContext = {
  weather: "Cold-weather",
  runType: "Tempo run",
  preference: "Lightweight requirement",
};

const rankedGear: RankedGearRecommendation[] = [
  {
    rank: 1,
    name: "Harrier Long Sleeve",
    brand: "Tracksmith",
    category: "Base layer",
    score: 96,
    breakdown: {
      weather: 35, 
      intensity:25,
      terrain: 12,
      seasonality: 14,
      brandAffinity: 10,
      rotationAdjustment: 0,
    },
    matchLabel: "Best overall match",
    description:
      "A warm-but-breathable first layer that can handle faster winter miles without feeling bulky.",
    why:
      "Recommended because it matches cold-weather + tempo run + lightweight requirement.",
    signals: [
      { label: "Weather fit", value: "Cold-rated warmth without heavy insulation" },
      { label: "Workout fit", value: "Breathes well at tempo intensity" },
      { label: "Preference fit", value: "Low-bulk merino blend" },
    ],
    tags: ["cold-weather", "tempo", "lightweight", "breathable"],
  },
  {
    rank: 2,
    name: "Superbeam Next Gen Pocket Half Tight",
    brand: "Bandit",
    category: "Bottom",
    score: 91,
    breakdown: {
      weather: 32,
      intensity: 24,
      terrain: 10,
      seasonality: 15,
      brandAffinity: 0,
      rotationAdjustment: 10,
    },
    matchLabel: "Most efficient warmth",
    description:
      "Light compression and brushed warmth protect large muscle groups while preserving stride freedom.",
    why:
      "Recommended because it balances cold-weather coverage with tempo-run mobility and a lightweight feel.",
    signals: [
      { label: "Weather fit", value: "Thermal face reduces cold exposure" },
      { label: "Workout fit", value: "Secure fit supports quick cadence" },
      { label: "Preference fit", value: "Half-tight cut avoids extra fabric" },
    ],
    tags: ["cold-weather", "mobility", "secure-fit", "low-bulk"],
  },
  {
    rank: 3,
    name: "Zephyrunner Wind Shell",
    brand: "Janji",
    category: "Outer layer",
    score: 88,
    breakdown: {
      weather: 35,
      intensity: 18,
      terrain: 12,
      seasonality: 13,
      brandAffinity: 10,
      rotationAdjustment: 0,
    },
    matchLabel: "Best weather buffer",
    description:
      "A featherweight shell blocks exposed wind at the chest and packs down if the pace heats up.",
    why:
      "Recommended because it adds cold-weather protection for tempo pacing without breaking the lightweight requirement.",
    signals: [
      { label: "Weather fit", value: "Wind-blocking front panel" },
      { label: "Workout fit", value: "Sleeveless design vents during harder efforts" },
      { label: "Preference fit", value: "Packable layer instead of a full jacket" },
    ],
    tags: ["wind", "packable", "lightweight", "layering"],
  },
];

const contextPills = Object.values(recommendationContext);

export default function RecommendationPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-background to-background px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-end">
          <div className="space-y-5">
            <Badge
              variant="outline"
              className="rounded-full border-emerald-200 bg-white/80 px-3 py-1 text-emerald-700 shadow-sm"
            >
              <Sparkles className="size-3.5" /> Recommendation result
            </Badge>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                Ranked gear for your next run
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                Each recommendation is scored against the run context, then explained in plain language so runners know exactly why it made the list.
              </p>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Recommendation context">
              {contextPills.map((pill) => (
                <Badge
                  key={pill}
                  variant="outline"
                  className="rounded-full border-slate-200 bg-white px-3 py-1 text-slate-700"
                >
                  {pill}
                </Badge>
              ))}
            </div>
          </div>

          <Card className="border-emerald-100 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-950">
                <Gauge className="size-5 text-emerald-600" /> Match inputs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { icon: CloudSnow, label: "Weather", value: recommendationContext.weather },
                { icon: Award, label: "Run type", value: recommendationContext.runType },
                { icon: Layers, label: "Preference", value: recommendationContext.preference },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center justify-between gap-4 rounded-2xl border bg-slate-50 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                      <Icon className="size-4" />
                    </span>
                    <span className="text-sm font-medium text-slate-600">{label}</span>
                  </div>
                  <span className="text-sm font-semibold text-slate-950">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-5" aria-label="Ranked gear recommendations">
          {rankedGear.map((gear) => (
            <Card
              key={gear.rank}
              className="overflow-hidden border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div className="grid gap-0 lg:grid-cols-[220px_1fr]">
                <div className="flex flex-col justify-between gap-6 border-b bg-slate-950 p-6 text-white lg:border-b-0 lg:border-r">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-emerald-200">Rank #{gear.rank}</p>
                    <div className="text-5xl font-semibold tracking-tight">{gear.score}</div>
                    <p className="text-sm text-slate-300">match score</p>
                  </div>
                  <Badge className="w-fit rounded-full bg-emerald-500 px-3 py-1 text-white">
                    {gear.matchLabel}
                  </Badge>
                </div>

                <div className="p-6 md:p-7">
                  <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          <span>{gear.brand}</span>
                          <ChevronRight className="size-4" />
                          <span>{gear.category}</span>
                        </div>
                        <h2 className="text-2xl font-semibold text-slate-950">{gear.name}</h2>
                        <p className="max-w-2xl leading-7 text-muted-foreground">{gear.description}</p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        {gear.signals.map((signal) => (
                          <div key={signal.label} className="rounded-2xl border bg-slate-50 p-4">
                            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-950">
                              <CheckCircle2 className="size-4 text-emerald-600" /> {signal.label}
                            </div>
                            <p className="text-sm leading-6 text-muted-foreground">{signal.value}</p>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {gear.tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="rounded-full border-emerald-100 bg-emerald-50 px-3 py-1 text-emerald-700"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <aside className="space-y-4 rounded-3xl border border-emerald-100 bg-emerald-50/80 p-5">
                      <div>
                        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-800">
                          <Sparkles className="size-4" /> Why this was recommended
                        </div>
                        <p className="text-base leading-7 text-emerald-950">{gear.why}</p>
                      </div>
                      <RecommendationScoreBreakdown totalScore={gear.score} breakdown={gear.breakdown} />
                      <RecommendationFeedbackControls recommendationId={gear.recommendationId} />
                    </aside>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
}
