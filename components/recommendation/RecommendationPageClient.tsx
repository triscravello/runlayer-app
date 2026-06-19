"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RecommendationFeedbackControls } from "@/components/recommendation/RecommendationFeedbackControls";
import { RecommendationScoreBreakdown } from "@/components/recommendation/RecommendationScoreBreakdown";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { recommendationService, type GearRecommendationResult, type UserInput } from "@/services/recommendationService";
import { weatherService, type NormalizedWeather } from "@/services/weatherService";
import type { RecommendationScoreBreakdown as ScoreBreakdown, ScoredRecommendationItem, WeatherCondition, Intensity, Terrain } from "@/lib/engine/types/recommendationEngine";
import type { UserProfile } from "@/lib/types/user";
import { Award, CheckCircle2, ChevronRight, CloudSnow, Gauge, Layers, RefreshCw, Sparkles } from "lucide-react";

type RecommendationSignal = { label: string; value: string };

type RankedGearRecommendation = {
  id: string;
  rank: number;
  recommendationId?: string;
  name: string;
  brand: string;
  category: string;
  score: number;
  breakdown: ScoreBreakdown;
  matchLabel: string;
  description: string;
  why: string;
  signals: RecommendationSignal[];
  tags: string[];
};

type AlternativeCategoryKey = "top" | "bottom" | "accessory";

type AlternativeCategoryGroup = {
  key: AlternativeCategoryKey;
  title: string;
  items: RankedGearRecommendation[];
}

type RecommendationPageClientProps = {
  user: { id: string; location: string | null };
  profile: UserProfile | null;
  engineVersion: string;
};

type EngineContext = {
  weather: WeatherCondition;
  runType: Intensity;
  terrain: Terrain;
  category: "all";
  location: string;
  weatherSummary: string;
  profileSignals: string[];
};

const DEFAULT_CONTEXT: EngineContext = {
  weather: "cold",
  runType: "easy",
  terrain: "road",
  category: "all",
  location: "your saved location",
  weatherSummary: "Weather unavailable; using a conservative default",
  profileSignals: [],
};

function weatherConditionFromWeather(weather: NormalizedWeather | null): WeatherCondition {
  if (!weather) return "cold";
  const condition = weather.condition.toLowerCase();
  if (condition.includes("rain") || weather.precipitationChance >= 0.5) return "rain";
  if (weather.windSpeed >= 15) return "wind";
  if (weather.humidity >= 75 && (weather.tempCategory === "warm" || weather.tempCategory === "hot")) return "humid";
  if (weather.tempCategory === "hot" || weather.tempCategory === "warm") return "hot";
  return "cold";
}

function terrainFromProfile(profile: UserProfile | null): Terrain {
  const terrain = profile?.terrainPreference?.toLowerCase();
  if (terrain === "trail") return "trail";
  return "road";
}

function buildProfileSignals(profile: UserProfile | null): string[] {
  if (!profile) return [];
  const signals: string[] = [];
  if (profile.preferredBrands.length) signals.push(`favorite brands: ${profile.preferredBrands.join(", ")}`);
  if (profile.avoidedBrands.length) signals.push(`avoided brands: ${profile.avoidedBrands.join(", ")}`);
  if (profile.budgetLevel) signals.push(`${profile.budgetLevel.toLowerCase()} budget`);
  if (profile.heatTolerance) signals.push(`${String(profile.heatTolerance).toLowerCase()} heat tolerance`);
  if (profile.coldTolerance) signals.push(`${String(profile.coldTolerance).toLowerCase()} cold tolerance`);
  if (profile.terrainPreference) signals.push(`${profile.terrainPreference.toLowerCase()} terrain preference`);
  return signals;
}

function buildEngineContext(profile: UserProfile | null, weather: NormalizedWeather | null, userLocation: string | null): EngineContext {
  const location = weather?.location ?? profile?.location ?? userLocation ?? DEFAULT_CONTEXT.location;
  const weatherSummary = weather
    ? `${weather.tempCategory} ${weather.condition.toLowerCase()}, feels like ${Math.round(weather.feelsLikeF)}°F`
    : DEFAULT_CONTEXT.weatherSummary;

  return {
    weather: weatherConditionFromWeather(weather),
    runType: "easy",
    terrain: terrainFromProfile(profile),
    category: "all",
    location,
    weatherSummary,
    profileSignals: buildProfileSignals(profile),
  };
}

function toRecommendationInput(context: EngineContext, userId: string): UserInput {
  return {
    userId,
    weather: context.weather,
    intensity: context.runType,
    workoutType: context.runType,
    terrain: context.terrain,
    category: context.category,
  };
}

function matchLabel(score: number, rank: number) {
  if (rank === 1) return "Best overall match";
  if (score >= 80) return "Strong personalized match";
  if (score >= 60) return "Good profile fit";
  return "Worth considering";
}

function mapRecommendation(item: ScoredRecommendationItem, index: number): RankedGearRecommendation {
  const rank = index + 1;
  const brand = item.item.brandName ?? "Runlayer curated gear";
  const category = item.item.category ?? "Gear";
  const tags = item.item.tags.slice(0, 5);
  const primaryReason = item.reasons[0] ?? "Selected for this run based on your conditions and saved profile.";

  return {
    id: item.item.id,
    rank,
    recommendationId: item.recommendationId,
    name: item.item.name,
    brand,
    category,
    score: Math.round(item.totalScore),
    breakdown: item.scoreBreakdown,
    matchLabel: matchLabel(item.totalScore, rank),
    description: `${brand} ${item.item.name} gives you ${category.toLowerCase()} coverage for the run conditions and profile signals available today.`,
    why: item.reasons.length ? item.reasons.join(" ") : primaryReason,
    signals: [
      { label: "Weather fit", value: item.scoreBreakdown.weather > 0 ? "Suited to today's conditions." : "A workable option for the current forecast." },
      { label: "Run fit", value: item.scoreBreakdown.intensity + item.scoreBreakdown.terrain > 0 ? "Matches your planned effort and route." : "Included as a flexible backup for this run." },
      { label: "Profile fit", value: item.scoreBreakdown.brandAffinity + item.scoreBreakdown.budget + item.scoreBreakdown.temperatureTolerance + item.scoreBreakdown.genderAlignment > 0 ? "Reflects your saved fit, comfort, and shopping preferences." : "Kept in the mix as a practical alternative." },
    ],
    tags: tags.length ? tags : [category.toLowerCase()],
  };
}

const ALTERNATIVE_CATEGORY_LABELS: Array<{ key: AlternativeCategoryKey; title: string }> = [
  { key: "top", title: "Alternative tops" },
  { key: "bottom", title: "Alternative bottoms" },
  { key: "accessory", title: "Alternative accessories" },
];

function LoadingState() {
  return <Card className="border-emerald-100 bg-white/90 p-6 shadow-sm"><div className="space-y-4"><Skeleton className="h-6 w-56" /><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div></Card>;
}

export function RecommendationPageClient({ user, profile, engineVersion }: RecommendationPageClientProps) {
  const [result, setResult] = useState<GearRecommendationResult | null>(null);
  const [weather, setWeather] = useState<NormalizedWeather | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  const context = useMemo(() => buildEngineContext(profile, weather, user.location), [profile, weather, user.location]);
  const gear = useMemo(() => result?.recommendations.map(mapRecommendation) ?? [], [result]);
  const outfitGear = useMemo(() => {
    if (!result?.recommendedOutfit) return [];
    return [result.recommendedOutfit.top, result.recommendedOutfit.bottom, result.recommendedOutfit.accessory]
      .filter((item): item is ScoredRecommendationItem => Boolean(item))
      .map(mapRecommendation);
  }, [result]);
  const alternativeGroups = useMemo<AlternativeCategoryGroup[]>(() => {
    const selectedOutfitIds = new Set(outfitGear.map((item) => item.id));

    if (result?.alternativesByCategory) {
      return ALTERNATIVE_CATEGORY_LABELS.map(({ key, title }) => ({
        key,
        title,
        items: (result.alternativesByCategory?.[key] ?? []).map(mapRecommendation),
      }));
    }

    const fallbackAlternatives = result?.alternatives?.map(mapRecommendation) ?? gear.filter((item) => !selectedOutfitIds.has(item.id));

    return ALTERNATIVE_CATEGORY_LABELS.map(({ key, title }) => ({
      key,
      title,
      items: fallbackAlternatives.filter((item) => item.category.toLowerCase() === key),
    }));
  }, [gear, outfitGear, result]);
  const hasAlternativeGear = alternativeGroups.some((group) => group.items.length > 0);
  const hasEnoughProfileData = context.profileSignals.length >= 2;

  useEffect(() => {
    const controller = new AbortController();

    async function loadRecommendations() {
      setIsLoading(true);
      setError("");
      try {
        const location = profile?.location ?? user.location;
        const liveWeather = location ? await weatherService.getWeather(location, { signal: controller.signal }) : null;
        if (controller.signal.aborted) return;
        setWeather(liveWeather);
        const nextContext = buildEngineContext(profile, liveWeather, user.location);
        const nextResult = await recommendationService.generateRecommendations(toRecommendationInput(nextContext, user.id), { signal: controller.signal });
        if (!controller.signal.aborted) setResult(nextResult);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load recommendations.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    loadRecommendations();
    return () => controller.abort();
  }, [profile, user.id, user.location, retryKey]);

  const retry = useCallback(() => setRetryKey((key) => key + 1), []);
  const contextPills = [context.weatherSummary, `${context.runType} run`, context.terrain, ...context.profileSignals.slice(0, 2)];

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-background to-background px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-end">
          <div className="space-y-5">
            <Badge variant="outline" className="rounded-full border-emerald-200 bg-white/80 px-3 py-1 text-emerald-700 shadow-sm"><Sparkles className="size-3.5" /> Outfit recommendation</Badge>
            <div className="space-y-3">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">An outfit-first kit for your next run</h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground">Start with a balanced top, bottom, and accessory when available, then compare non-duplicate alternatives selected for your weather, run context, and saved profile.</p>
              <p className="text-sm font-medium text-emerald-700">Recommendation generated by Engine v{result?.engineVersion ?? engineVersion}</p>
              <p className="text-sm text-slate-600">{hasEnoughProfileData ? "Personalized using your profile preferences, budget, tolerance settings, and brand signals." : "Add more profile preferences to increase personalization confidence."}</p>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Recommendation context">{contextPills.map((pill) => <Badge key={pill} variant="outline" className="rounded-full border-slate-200 bg-white px-3 py-1 text-slate-700">{pill}</Badge>)}</div>
          </div>
          <Card className="border-emerald-100 bg-white/90 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-950"><Gauge className="size-5 text-emerald-600" /> Match inputs</CardTitle></CardHeader><CardContent className="space-y-3">{[{ icon: CloudSnow, label: "Weather", value: context.weatherSummary }, { icon: Award, label: "Run type", value: `${context.runType} run` }, { icon: Layers, label: "Profile", value: context.profileSignals.length ? context.profileSignals.slice(0, 2).join(" • ") : "Default runner profile" }].map(({ icon: Icon, label, value }) => <div key={label} className="flex items-center justify-between gap-4 rounded-2xl border bg-slate-50 px-4 py-3"><div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Icon className="size-4" /></span><span className="text-sm font-medium text-slate-600">{label}</span></div><span className="text-right text-sm font-semibold text-slate-950">{value}</span></div>)}</CardContent></Card>
        </section>

        {isLoading ? <LoadingState /> : null}
        {!isLoading && error ? <Card className="border-red-100 bg-white p-8 text-center shadow-sm"><h2 className="text-2xl font-semibold text-slate-950">Couldn&apos;t load recommendations</h2><p className="mt-2 text-muted-foreground">{error}</p><Button onClick={retry} className="mt-5 bg-emerald-600 text-white hover:bg-emerald-700"><RefreshCw className="size-4" /> Retry</Button></Card> : null}
        {!isLoading && !error && gear.length === 0 ? <Card className="border-emerald-100 bg-white p-8 text-center shadow-sm"><h2 className="text-2xl font-semibold text-slate-950">No recommendations yet</h2><p className="mt-2 text-muted-foreground">The engine did not return ranked gear for this context. Try updating your profile or adding more gear metadata.</p><Button onClick={retry} variant="outline" className="mt-5">Refresh recommendations</Button></Card> : null}

        {!isLoading && !error && gear.length ? <section className="grid gap-5" aria-label="Outfit-first gear recommendations">{(outfitGear.length ? outfitGear : gear).map((gearItem) => <Card key={gearItem.id} className="overflow-hidden border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"><div className="grid gap-0 lg:grid-cols-[220px_1fr]"><div className="flex flex-col justify-between gap-6 border-b bg-slate-950 p-6 text-white lg:border-b-0 lg:border-r"><div className="space-y-2"><p className="text-sm font-medium text-emerald-200">{outfitGear.some((item) => item.id === gearItem.id) ? "Outfit pick" : `Rank #${gearItem.rank}`}</p><div className="text-5xl font-semibold tracking-tight">{gearItem.score}</div><p className="text-sm text-slate-300">match score</p></div><Badge className="w-fit rounded-full bg-emerald-500 px-3 py-1 text-white">{gearItem.matchLabel}</Badge></div><div className="p-6 md:p-7"><div className="grid gap-6 xl:grid-cols-[1fr_380px]"><div className="space-y-5"><div className="space-y-2"><div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{gearItem.brand}</span><ChevronRight className="size-4" /><span>{gearItem.category}</span></div><h2 className="text-2xl font-semibold text-slate-950">{gearItem.name}</h2><p className="max-w-2xl leading-7 text-muted-foreground">{gearItem.description}</p></div><div className="grid gap-3 md:grid-cols-3">{gearItem.signals.map((signal) => <div key={signal.label} className="rounded-2xl border bg-slate-50 p-4"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-950"><CheckCircle2 className="size-4 text-emerald-600" /> {signal.label}</div><p className="text-sm leading-6 text-muted-foreground">{signal.value}</p></div>)}</div><div className="flex flex-wrap gap-2">{gearItem.tags.map((tag) => <Badge key={`${gearItem.id}-${tag}`} variant="outline" className="rounded-full border-emerald-100 bg-emerald-50 px-3 py-1 text-emerald-700">{tag}</Badge>)}</div></div><aside className="space-y-4 rounded-3xl border border-emerald-100 bg-emerald-50/80 p-5"><div><div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-800"><Sparkles className="size-4" /> Why this was recommended</div><p className="text-base leading-7 text-emerald-950">{gearItem.why}</p></div><RecommendationScoreBreakdown totalScore={gearItem.score} breakdown={gearItem.breakdown} /><RecommendationFeedbackControls recommendationId={gearItem.recommendationId} /></aside></div></div></div></Card>)}</section> : null}

        {!isLoading && !error && hasAlternativeGear ? <section className="grid gap-5" aria-label="Alternative gear recommendations"><div><h2 className="text-2xl font-semibold text-slate-950">Alternatives by category</h2><p className="mt-1 text-muted-foreground">Swap one outfit slot at a time with category-matched, non-duplicate options.</p></div>{alternativeGroups.map((group) => group.items.length ? <div key={group.key} className="grid gap-3"><h3 className="text-lg font-semibold text-slate-900">{group.title}</h3><div className="grid gap-3">{group.items.map((gearItem) => <Card key={`alternative-${group.key}-${gearItem.id}`} className="border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{gearItem.brand}</span><ChevronRight className="size-4" /><span>{gearItem.category}</span></div><h4 className="mt-1 text-xl font-semibold text-slate-950">{gearItem.name}</h4><p className="mt-1 text-sm text-muted-foreground">{gearItem.why}</p></div><Badge className="w-fit rounded-full bg-slate-950 px-3 py-1 text-white">{gearItem.matchLabel}</Badge></div></Card>)}</div></div> : null)}</section> : null}
      </div>
    </main>
  );
}