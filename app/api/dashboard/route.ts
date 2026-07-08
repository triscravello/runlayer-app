import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { BadRequestError, HttpError } from "@/lib/http/apiErrors";
import { getRunTypeRecommendation } from "@/lib/recommendations/recommendationService";
import { validRunTypes, type RecommendationWeather, type RunType } from "@/lib/recommendations/recommendationTypes";
import { weatherClient } from "@/lib/weather/weatherClient";
import { weatherNormalizer } from "@/lib/weather/weatherNormalizer";

function getRunType(request: Request): RunType {
    const { searchParams } = new URL(request.url);
    const runType = searchParams.get("runType") ?? "easy";

    return validRunTypes.has(runType as RunType) ? (runType as RunType) : "easy";
}

type DashboardWeather = RecommendationWeather;

const DEFAULT_WEATHER_LOCATION = "New York, NY";

function getSavedLocation(user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) {
  return user.location?.trim() || DEFAULT_WEATHER_LOCATION;
}

function buildWeatherLabels(weather: {
  tempF: number;
  humidity: number;
  precipitationChance: number;
  windSpeed: number;
  uvIndex: number;
  condition: string;
  tempCategory: string;
}) {
  const labels: string[] = [];
  const condition = weather.condition.toLowerCase();

  if (weather.tempF >= 88 || weather.tempCategory === "hot") {
    labels.push("Hot conditions");
  } else if (weather.tempF >= 76 || weather.tempCategory === "warm") {
    labels.push("Warm conditions");
  } else if (weather.tempF <= 45 || weather.tempCategory === "cold") {
    labels.push("Cold conditions");
  }

  if (weather.humidity >=65 || condition.includes("humid")) {
    labels.push("High humidity");
  }

  if (weather.precipitationChance >= 0.4 || condition.includes("rain") || condition.includes("storm")) {
    labels.push("Rain risk");
  }

  if (weather.windSpeed >= 15) {
    labels.push("Wind exposure");
  }

  if (weather.uvIndex >= 7) {
    labels.push("High UV");
  }

  return labels;
}

function getImpactLabel(weather: {
  tempF: number;
  humidity: number;
  precipitationChance: number;
  condition: string;
}) {
  const condition = weather.condition.toLowerCase();

  if (weather.tempF >= 84 && weather.humidity >= 65) {
    return "High sweat risk";
  }

  if (condition.includes("rain") || weather.precipitationChance >= 0.4) {
    return "Wet gear risk";
  }

  if (weather.tempF <= 45) {
    return "Layering needed";
  }

  if (weather.tempF >= 84) {
    return "Heat management";
  }

  return "Balanced conditions";
}

function getRecommendationNote(labels: string[]) {
  if (!labels.length) {
    return "Recommendations can stay balanced because the weather is not pushing a strong gear constraint.";
  }

  const labelSummary = labels.slice(0, 2).map((label) => label.toLowerCase()).join(" and ");
  return `Recommendations respond to ${labelSummary}, so fabric weight, coverage, and drying speed match the current conditions.`;
}

async function getDashboardWeather(location: string): Promise<DashboardWeather> {
  const rawWeather = await weatherClient.fetchWeather(location);
  const weather = weatherNormalizer.normalize(rawWeather);
  const labels = buildWeatherLabels(weather);

  return {
    location: weather.location,
    temperature: weather.tempF,
    feelsLike: weather.feelsLikeF,
    condition: weather.condition,
    humidity: weather.humidity,
    precipitationChance: weather.precipitationChance,
    windSpeed: weather.windSpeed,
    uvIndex: weather.uvIndex,
    impactLabel: getImpactLabel(weather),
    labels,
    recommendationNote: getRecommendationNote(labels),
  }
}

function dashboardErrorResponse(error: unknown) {
  if (error instanceof BadRequestError) {
    return NextResponse.json(
      { error: { code: "INVALID_LOCATION", message: error.message } },
      { status: 400 },
    );
  }

  if (error instanceof HttpError || error instanceof TypeError) {
    console.error("OpenWeather request failed", error);
    return NextResponse.json(
      { error: { code: "WEATHER_PROVIDER_ERROR", message: "OpenWeather request failed" } },
      { status: 502 },
    );
  }

  if (error instanceof Error && error.message === "Missing WEATHER_API_KEY") {
    console.error("OpenWeather configuration failed", error);
    return NextResponse.json(
      { error: { code: "WEATHER_PROVIDER_ERROR", message: "OpenWeather request failed" } },
      { status: 502 },
    );
  }

  console.error("Unexpected dashboard error", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to load dashboard" } },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();

    if (!user) {
        return NextResponse.json(
            { error: { code: "UNAUTHORIZED", message: "Authentication is required." } },
            { status: 401 },
        );
    }

    const location = getSavedLocation(user);
    const runType = getRunType(request);

    let weather: DashboardWeather;

    try {
      weather = await getDashboardWeather(location);
    } catch (error) {
      console.error("Dashboard weather unavailable; using fallback weather", error);

      weather = {
        location,
        temperature: 72,
        feelsLike: 72,
        condition: "Weather unavailable",
        humidity: 50,
        precipitationChance: 0,
        windSpeed: 5,
        uvIndex: 3,
        impactLabel: "Balanced conditions",
        labels: ["Weather fallback"],
        recommendationNote: "Live weather is temporarily unavailable, so recommendations are using safe balanced conditions"
      }
    }
    
    const runData = getRunTypeRecommendation(runType, weather);

    return NextResponse.json({
        weather, 
        recommendation: runData.recommendation, 
        brands: runData.brands,
        stats: runData.stats,
    });
  } catch (error) {
    return dashboardErrorResponse(error);
  }
}