"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CloudSun, Dumbbell, Loader2, MapPinned, RefreshCw, Tag } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { RecommendationScoreBreakdown } from "@/components/recommendation/RecommendationScoreBreakdown";
import { RecommendationFeedbackControls } from "@/components/recommendation/RecommendationFeedbackControls";
import { useAuth } from "@/context/authContext";
import { recommendationService, type RecommendationHistoryRecord } from "@/services/recommendationService";
import type { RecommendationScoreBreakdown as ScoreBreakdown } from "@/lib/engine/types/recommendationEngine";

type InputContext = {
    weather?: string | null;
    workoutType?: string | null;
    terrain?: string | null;
    category?: string | null;
};

function getEngineVersion(record: RecommendationHistoryRecord) {
    return record.engineVersion ?? record.algorithmVersion ?? "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getString(value: unknown) {
    return typeof value === "string" && value.length ? value : null;
}

function getInputContext(history: RecommendationHistoryRecord): InputContext {
    const context = asRecord(history.inputContext);

    return {
        weather: getString(context.weather) ?? history.weatherSnapshot?.condition ?? null,
        workoutType: getString(context.workoutType),
        terrain: getString(context.terrain),
        category: getString(context.category),
    };
}

function getBreakdown(value: unknown): ScoreBreakdown {
    const record = asRecord(value);

    return {
        weather: Number(record.weather ?? 0),
        intensity: Number(record.intensity ?? 0),
        terrain: Number(record.terrain ?? 0),
        seasonality: Number(record.seasonality ?? 0),
        brandAffinity: Number(record.brandAffinity ?? 0),
        brandPenalty: Number(record.brandPenalty ?? 0),
        budget: Number(record.budget ?? 0),
        genderAlignment: Number(record.genderAlignment ?? 0),
        temperatureTolerance: Number(record.temperatureTolerance ?? 0),
        rotationAdjustment: Number(record.rotationAdjustment ?? 0),
    };
}

const historyDateFormatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
});

function formatDate(value: string | Date) {
    return historyDateFormatter.format(new Date(value));
}

export default function RecommendationHistoryPage() {
    const { user, loading } = useAuth();
    const [history, setHistory] = useState<RecommendationHistoryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    const loadHistory = useCallback(async (signal?: AbortSignal) => {
        const userId = user?.id;

        if (!userId) {
            setHistory([]);
            return;
        }

        setIsLoading(true);
        setError("");

        try {
            const records = await recommendationService.getRecommendationHistory({ userId, limit: 20 }, { signal });
            if (!signal?.aborted) setHistory(records);
        } catch (err) {
            if (!signal?.aborted) {
                setError(err instanceof Error ? err.message : "Unable to load recommendation history.")
            }
        } finally {
            if (!signal?.aborted) setIsLoading(false);
        }
    }, [user?.id]);

    useEffect(() => {
        if (loading) return;

        const controller = new AbortController();

        async function loadHistoryAfterEffect() {
            await Promise.resolve();
            await loadHistory(controller.signal);
        }

        void loadHistoryAfterEffect();

        return () => controller.abort();
    }, [loadHistory, loading]);

    const emptyStateMessage = useMemo(() => {
        if (loading) return "Checking your session...";
        if (!user) return "Log in to view your recommendation history";
        return "Generate recommendations to build your history.";
    }, [loading, user]);

    const shouldShowEmptyState = !loading && !isLoading && !error && history.length === 0;

    return (
        <main className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
            <div className="mx-auto max-w-6xl space-y-6">
                <section className="space-y-2">
                    <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Dashboard</p>
                    <h1 className="text-3xl font-semibold text-slate-950">Recommendation history</h1>
                    <p className="max-w-2xl text-muted-foreground">
                        Revisit past weather and workout inputs, inspect score breakdowns, and submit feedback for future personalization.
                    </p>
                </section>

                {isLoading || loading ? (
                    <Card>
                        <CardContent aria-live="polite" className="flex items-center gap-2 py-8 text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" /> Loading recommendation history...
                        </CardContent>
                    </Card>
                ) : null}

                {error ? (
                    <Card className="border-red-200 bg-red-50">
                        <CardContent className="flex flex-col gap-3 py-4 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
                            <p role="alert">{error}</p>
                            <Button type="button" variant="outline" size="sm" onClick={() => void loadHistory()} disabled={isLoading || loading || !user?.id} className="border-red-200 bg-white text-red-700 hover:bg-red-100">
                                <RefreshCw className="size-4" /> Retry
                            </Button>
                        </CardContent>
                    </Card>
                ): null}

                {shouldShowEmptyState ? (
                    <Card>
                        <CardContent aria-live="polite" className="py-8 text-muted-foreground">{emptyStateMessage}</CardContent>
                    </Card>
                ): null}

                <div className="space-y-4">
                    {history.map((record) => {
                        const context = getInputContext(record);
                        const topItems = record.items.slice(0, 3);

                        return (
                            <Card key={record.id} className="border-emerald-100 bg-white shadow-sm">
                                <CardHeader>
                                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                        <CardTitle className="flex items-center gap-2 text-xl text-slate-950">
                                            <CalendarClock className="size-5 text-emerald-600" /> {formatDate(record.createdAt)}
                                        </CardTitle>
                                        <div className="flex flex-wrap gap-2">
                                            <Badge variant="outline" className="rounded-full bg-slate-50 text-slate-700">
                                                Engine v{getEngineVersion(record)}
                                            </Badge>
                                            <Badge variant="outline" className="rounded-full bg-orange-50 text-orange-700">
                                                <CloudSun className="size-3" /> {context.weather ?? "Weather not captured"}
                                            </Badge>
                                            <Badge variant="outline" className="rounded-full bg-emerald-50 text-emerald-700">
                                                <Dumbbell className="size-3" /> {context.workoutType ?? "Workout not captured"}
                                            </Badge>
                                            {context.terrain ? (
                                                <Badge variant="outline" className="rounded-full bg-sky-50 text-sky-700">
                                                    <MapPinned className="size-3" /> {context.terrain}
                                                </Badge>
                                            ) : null}
                                            {context.category ? (
                                                <Badge variant="outline" className="rounded-full bg-violet-50 text-violet-500">
                                                    <Tag className="size-3" /> {context.category}
                                                </Badge>
                                            ) : null}
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <p className="text-sm text-muted-foreground">Recommendation generated by Engine v{getEngineVersion(record)}.</p>
                                    {topItems.length ? (
                                        <div className="grid gap-4 lg:grid-cols-3">
                                            {topItems.map((item) => {
                                                const breakdown = getBreakdown(item.breakdown);
                                                const feedback = item.feedback[0]?.feedbackType ?? null;

                                                return (
                                                    <article key={item.id} className="space-y-3 rounded-2xl border bg-slate-50 p-4">
                                                        <div>
                                                            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                                                #{item.rank} Top Recommended Item
                                                            </div>
                                                            <h2 className="mt-1 font-semibold text-slate-950">{item.gearItem.name}</h2>
                                                            <p className="text-sm text-muted-foreground">
                                                                {[item.gearItem.brand?.name, item.gearItem.category].filter(Boolean).join(" • ")}
                                                            </p>
                                                        </div>
                                                        <RecommendationScoreBreakdown totalScore={item.totalScore} breakdown={breakdown} />
                                                        <RecommendationFeedbackControls
                                                            userId={user?.id}
                                                            recommendationId={item.id}
                                                            initialFeedback={feedback}
                                                        />
                                                    </article>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <div className="rounded-2xl border border-dashed bg-slate-50 p-4 text-sm text-muted-foreground">
                                            No ranked gear was saved with this recommendation, but the original context is still available above.
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </div>
        </main>
    );
}