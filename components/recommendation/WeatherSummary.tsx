import * as React from "react";
import { CloudRain, Droplets, Sun, Thermometer, Wind } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { Badge } from "@/components/ui/Badge";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from "@/components/ui/Card";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export type WeatherSummaryData = {
    location?: string;
    temperature?: number;
    tempF?: number;
    feelsLike?: number;
    feelsLikeF?: number;
    condition?: string;
    humidity?: number;
    precipitationChance?: number;
    windSpeed: number;
    uvIndex: number;
    tempCategory?: string;
};

export type WeatherSummaryProps = WeatherSummaryData & {
    weather?: WeatherSummaryData;
    title?: string;
    impactLabel?: string;
    labels?: string[];
    recommendationNote?: string;
    className?: string;
};

type WeatherCue = {
    label: string;
    tone: "heat" | "humidity" | "rain" | "wind" | "uv" | "cold";
};

const cueToneClasses: Record<WeatherCue["tone"], string> = {
  heat: "border-orange-200 bg-orange-50 text-orange-700",
  humidity: "border-sky-200 bg-sky-50 text-sky-700",
  rain: "border-blue-200 bg-blue-50 text-blue-700",
  wind: "border-slate-200 bg-slate-50 text-slate-700",
  uv: "border-amber-200 bg-amber-50 text-amber-700",
  cold: "border-cyan-200 bg-cyan-50 text-cyan-700",
};

function getTemperature(props: WeatherSummaryProps) {
  return props.temperature ?? props.tempF ?? props.weather?.temperature ?? props.weather?.tempF;
}

function getFeelsLike(props: WeatherSummaryProps) {
  return (
    props.feelsLike ??
    props.feelsLikeF ??
    props.weather?.feelsLike ??
    props.weather?.feelsLikeF
  );
}

function formatTemperature(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return `${Math.round(value)}°F`;
}

function formatPercent(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return undefined;
  }

  const normalizedValue = value <= 1 ? value * 100 : value;
  return `${Math.round(normalizedValue)}%`;
}

function getConditionIcon(condition?: string) {
  const normalizedCondition = condition?.toLowerCase() ?? "";
  const iconClassName = "size-5";

  if (normalizedCondition.includes("rain") || normalizedCondition.includes("storm")) {
    return <CloudRain className={iconClassName} />;
  }

  if (normalizedCondition.includes("humid") || normalizedCondition.includes("mist")) {
    return <Droplets className={iconClassName} />;
  }

  if (normalizedCondition.includes("wind")) {
    return <Wind className={iconClassName} />;
  }

  return <Sun className={iconClassName} />;
}

function buildWeatherCues(weather: WeatherSummaryData): WeatherCue[] {
  const cues: WeatherCue[] = [];
  const temperature = weather.temperature ?? weather.tempF;
  const humidity = weather.humidity;
  const precipitationChance = weather.precipitationChance;
  const condition = weather.condition?.toLowerCase() ?? "";

  if (typeof temperature === "number") {
    if (temperature >= 88) {
      cues.push({ label: "Hot conditions", tone: "heat" });
    } else if (temperature >= 76) {
      cues.push({ label: "Warm conditions", tone: "heat" });
    } else if (temperature <= 45) {
      cues.push({ label: "Cold conditions", tone: "cold" });
    }
  } else if (weather.tempCategory === "hot" || weather.tempCategory === "warm") {
    cues.push({ label: `${weather.tempCategory[0].toUpperCase()}${weather.tempCategory.slice(1)} conditions`, tone: "heat" });
  }

  if (typeof humidity === "number" && humidity >= 65) {
    cues.push({ label: "High humidity", tone: "humidity" });
  } else if (condition.includes("humid")) {
    cues.push({ label: "Humid air", tone: "humidity" });
  }

  if (
    condition.includes("rain") ||
    condition.includes("storm") ||
    (typeof precipitationChance === "number" && precipitationChance >= 0.4)
  ) {
    cues.push({ label: "Rain risk", tone: "rain" });
  }

  if (typeof weather.windSpeed === "number" && weather.windSpeed >= 15) {
    cues.push({ label: "Wind exposure", tone: "wind" });
  }

  if (typeof weather.uvIndex === "number" && weather.uvIndex >= 7) {
    cues.push({ label: "High UV", tone: "uv" });
  }

  return cues;
}

function getImpactLabel(weather: WeatherSummaryData) {
  const temperature = weather.temperature ?? weather.tempF;
  const humidity = weather.humidity;
  const precipitationChance = weather.precipitationChance;
  const condition = weather.condition?.toLowerCase() ?? "";

  if (typeof temperature === "number" && temperature >= 84 && typeof humidity === "number" && humidity >= 65) {
    return "High sweat risk";
  }

  if (condition.includes("rain") || (typeof precipitationChance === "number" && precipitationChance >= 0.4)) {
    return "Wet gear risk";
  }

  if (typeof temperature === "number" && temperature <= 45) {
    return "Layering needed";
  }

  if (typeof temperature === "number" && temperature >= 84) {
    return "Heat management";
  }

  return undefined;
}

function getRecommendationNote(cues: WeatherCue[]) {
  if (!cues.length) {
    return "Recommendations can stay balanced because the weather is not pushing a strong gear constraint.";
  }

  const cueLabels = cues.slice(0, 2).map((cue) => cue.label.toLowerCase());
  return `Recommendations favor ${cueLabels.join(" and ")} responses, so fabric weight, coverage, and drying speed match the conditions.`;
}

export function WeatherSummary(props: WeatherSummaryProps) {
    const weather = {
        ...props.weather,
        location: props.location ?? props.weather?.location,
        temperature: getTemperature(props),
        feelsLike: getFeelsLike(props),
        condition: props.condition ?? props.weather?.condition,
        humidity: props.humidity ?? props.weather?.humidity,
        precipitationChance: props.precipitationChance ?? props.weather?.precipitationChance,
        windSpeed: props.windSpeed ?? props.weather?.windSpeed,
        uvIndex: props.uvIndex ?? props.weather?.uvIndex,
        tempCategory: props.tempCategory ?? props.weather?.tempCategory,
    } satisfies WeatherSummaryData;

    const cues = buildWeatherCues(weather);
    const customCues = props.labels?.map<WeatherCue>((label) => ({ label, tone: "heat" })) ?? [];
    const displayCues = [...cues, ...customCues].filter(
        (cue, index, allCues) => allCues.findIndex((candidate) => candidate.label === cue.label) === index,
    );
    const condition = weather.condition ?? "Current conditions";
    const conditionIcon = getConditionIcon(condition);
    const impactLabel = props.impactLabel ?? getImpactLabel(weather);
    const feelsLike = weather.feelsLike ?? weather.temperature;

    return (
        <Card 
            className={cn(
                "overflow-hidden border-orange-100 bg-gradient-to-br from-white via-white to-orange-50/50 shadow-sm",
                props.className
            )}
        >
            <CardHeader className="border-b border-orange-100/70 pb:4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">
                            Weather context
                        </p>
                        <CardTitle className="text-xl font-semibold text-slate-950">
                            {props.title ?? "Today's conditions"}
                        </CardTitle>
                        {weather.location ? (
                            <p className="text-sm text-muted-foreground">{weather.location}</p>
                        ) : null}
                    </div>

                    {impactLabel ? (
                        <Badge className="rounded-fill border-orange-200 bg-orange-100 px-3 py-1 text-orange-800">
                            {impactLabel}
                        </Badge>
                    ) : null}
                </div>
            </CardHeader>

            <CardContent className="space-y-5 pt-5">
                <div className="grid gap-3 sm:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-2xl border border-orange-100 bg-white/80 p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                                    <Thermometer className="size-4 text-orange-600" />
                                    Temperature
                                </div>
                                <div className="mt-2 flex items-end gap-2">
                                    <span className="text-4xl font-semibold tracking-tight text-slate-950">
                                        {formatTemperature(weather.temperature)}
                                    </span>
                                    <span className="pb-1 text-sm text-muted-foreground">
                                        feels like {formatTemperature(feelsLike)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-sky-100 bg-white/80 p-4">
                        <div className="flex items-start gap-3">
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                                {conditionIcon}
                            </div>
                            <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-600">Condition</div>
                                <div className="mt-1 text-xl font-semibold capitalize text-slate-950">
                                    {condition}
                                </div>
                                {typeof weather.humidity === "number" ? (
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {weather.humidity}% humidity
                                    </p>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2" aria-label="Weather recommendation cues">
                    {displayCues.length ? (
                        displayCues.map((cue) => (
                            <Badge 
                                key={`${cue.tone}-${cue.label}`}
                                variant="outline"
                                className={cn("rounded-full px-3 py-1", cueToneClasses[cue.tone])}
                            >
                                {cue.label}
                            </Badge>
                        ))
                    ) : (
                        <Badge
                            variant="outline"
                            className="rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700"
                        >
                            Balanced conditions
                        </Badge>
                    )}
                </div>

                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-emerald-950">
                    <p className="font-medium">Why this affects the outfit</p>
                    <p className="mt-1 text-emerald-900/80">{props.recommendationNote ?? getRecommendationNote(displayCues)}</p>
                </div>

                {formatPercent(weather.precipitationChance) ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Precipitation: {formatPercent(weather.precipitationChance)}</span>
                        {typeof weather.windSpeed === "number" ? <span>Wind: {Math.round(weather.windSpeed)} mph</span> : null}
                        {typeof weather.uvIndex === "number" ? <span>UV Index: {Math.round(weather.uvIndex)}</span> : null}
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}