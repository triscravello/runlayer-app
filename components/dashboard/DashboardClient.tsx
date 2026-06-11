"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, LogOut, MapPin } from "lucide-react";

import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { OutfitCard, type OutfitCardPayload, type OutfitCardProps } from "../recommendation/OutfitCard";
import { WeatherSummary, type WeatherSummaryProps } from "../recommendation/WeatherSummary";
import { BrandList, type BrandListItem } from "../recommendation/BrandList";

export type DashboardUser = {
    id: string;
    email: string;
    role: string;
};

type RunType = "easy" | "long" | "intervals";

type DashboardStats = {
    savedOutfits: number;
    brandsTracked: number;
    accuracyPercent: number;
};

type DashboardRecommendation = {
    title: string;
    tags: OutfitCardProps["tags"];
    items: OutfitCardProps["items"];
    attributes: NonNullable<OutfitCardProps["attributes"]>;
    why: OutfitCardProps["why"];
};

type DashboardData = {
  weather: Required<Pick<WeatherSummaryProps,
    | "location"
    | "temperature"
    | "feelsLike"
    | "condition"
    | "humidity"
    | "precipitationChance"
    | "windSpeed"
    | "uvIndex"
  >> & {
    impactLabel: string;
    labels: string[];
    recommendationNote: string;
  };
  recommendation: DashboardRecommendation;
  brands: {
    filterTags: string[];
    items: BrandListItem[];
  };
  stats: DashboardStats;
};

const runTypeOptions: Array<{ value: RunType, label: string }> = [
    { value: "easy", label: "Easy" },
    { value: "long", label: "Long" },
    { value: "intervals", label: "Intervals" },
];

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Unable to load dashboard data";
}

export function DashboardClient({ user }: { user: DashboardUser }) {
    const router = useRouter();
    const [runType, setRunType] = useState<RunType>("easy");
    const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isLoggingOut, setIsLoggingOut] = useState(false);

    useEffect(() => {
        const controller = new AbortController();

        async function loadDashboardData() {
            setIsLoading(true);
            setError(null);

            try {
                const response = await fetch(`/api/dashboard?runType=${runType}`, {
                    signal: controller.signal,
                    cache: "no-store",
                });

                if (!response.ok) {
                    throw new Error("Dashboard data is not available right now.");
                }

                const data = (await response.json()) as DashboardData;
                setDashboardData(data);
            } catch (loadError) {
                if (controller.signal.aborted) {
                    return;
                }

                setError(getErrorMessage(loadError));
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            }
        }

        loadDashboardData();

        return () => controller.abort();
    }, [runType]);

    async function handleLogout() {
        setIsLoggingOut(true);

        try {
            await fetch("/api/auth/logout", {
                method: "POST",
                cache: "no-store",
            });
        } finally {
            router.push("/login");
            router.refresh();
        }
    }

    function handleSave(outfit: OutfitCardPayload) {
        console.log("Save outfit", outfit, user.id);
    }

    function handleViewDetails(outfit: OutfitCardPayload) {
        console.log("View outfit details", outfit, user.id);
    }

    return (
        <div className="min-h-screen bg-background p-4 md:p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                        <div className="space-y-1">
                            <h1 className="text-3xl">Command Center</h1>
                            <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <MapPin className="w-4 h-4" />
                            <input
                                type="text"
                                defaultValue={dashboardData?.weather.location ?? ""}
                                className="bg-transparent border-none outline-none"
                                aria-label="Dashboard location"
                            />
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleLogout}
                        disabled={isLoggingOut}
                        className="self-start"
                    >
                        {isLoggingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                        Logout
                    </Button>
                </div>

                {/* Run Type Selector */}
                <div className="flex gap-3" aria-label="Run type selector">
                    {runTypeOptions.map((option) => {
                        const isSelected = runType === option.value;

                        return (
                            <Button
                                key={option.value}
                                type="button"
                                variant={isSelected ? "default" : "outline"}
                                className={isSelected ? "bg-[#10B981] hover:bg-[#059669] text-white" : undefined}
                                aria-pressed={isSelected}
                                onClick={() => setRunType(option.value)}
                            >
                                {option.label}
                            </Button>
                        );
                    })}
                </div>

                {isLoading ? (
                    <Card className="p-6">
                        <div className="flex items-center gap-3 text-muted-foreground">
                            <Loader2 className="size-5 animate-spin" />
                            Loading your dashboard recommendations...
                        </div>
                    </Card>
                ) : error ? (
                    <Card className="p-6">
                        <div className="flex items-center gap-3 text-destructive">
                            <AlertCircle className="size-5" />
                            {error}
                        </div>
                    </Card>
                ) : dashboardData ? (
                    <>
                        {/* Weather Context */}
                        <WeatherSummary
                            location={dashboardData.weather.location}
                            temperature={dashboardData.weather.temperature}
                            feelsLike={dashboardData.weather.feelsLike}
                            condition={dashboardData.weather.condition}
                            humidity={dashboardData.weather.humidity}
                            precipitationChance={dashboardData.weather.precipitationChance}
                            windSpeed={dashboardData.weather.windSpeed}
                            uvIndex={dashboardData.weather.uvIndex}
                            impactLabel={dashboardData.weather.impactLabel}
                            labels={dashboardData.weather.labels}
                            recommendationNote={dashboardData.weather.recommendationNote}
                        />

                        {/* Primary Recommendation Card */}
                        <OutfitCard
                            title={dashboardData.recommendation.title}
                            tags={dashboardData.recommendation.tags}
                            items={dashboardData.recommendation.items}
                            attributes={dashboardData.recommendation.attributes}
                            why={dashboardData.recommendation.why}
                            onSave={handleSave}
                            onViewDetails={handleViewDetails}
                        />

                        {/* Brand Enrichment */}
                        <BrandList
                            layout="horizontal"
                            filterTags={dashboardData.brands.filterTags}
                            brands={dashboardData.brands.items}
                        />

                        {/* Quick Stats */}
                        <div className="grid grid-cols-3 gap-4">
                            <Card className="p-4">
                                <div className="text-2xl">{dashboardData.stats.savedOutfits}</div>
                                <div className="text-sm text-muted-foreground">Saved Outfits</div>
                            </Card>
                            <Card className="p-4">
                                <div className="text-2xl">{dashboardData.stats.brandsTracked}</div>
                                <div className="text-sm text-muted-foreground">Brands Tracked</div>
                            </Card>
                            <Card className="p-4">
                                <div className="text-2xl">{dashboardData.stats.accuracyPercent}</div>
                                <div className="text-sm text-muted-foreground">Accuracy</div>
                            </Card>
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
}