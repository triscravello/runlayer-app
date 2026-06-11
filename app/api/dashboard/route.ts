import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { BadRequestError, HttpError } from "@/lib/http/apiErrors";
import { weatherClient } from "@/lib/weather/weatherClient";
import { weatherNormalizer } from "@/lib/weather/weatherNormalizer";

type RunType = "easy" | "long" | "intervals";

const validRunTypes = new Set<RunType>(["easy", "long", "intervals"]);

const runTypeData = {
  easy: {
    recommendation: {
      title: "Recommended Outfit for an Easy Run",
      tags: [
        { label: "Hot", tone: "weather" },
        { label: "Easy Run", tone: "workout" },
        { label: "Breathable", tone: "attribute" },
      ],
      items: [
        {
          id: "lightweight-tank",
          label: "Lightweight Tank",
          category: "Top",
          description: "Open-knit singlet for heat release.",
          attributes: ["breathable", "no chafe"],
          icon: "👕",
        },
        {
          id: "split-shorts",
          label: "Split Shorts",
          category: "Bottom",
          description: "Short inseam keeps stride unrestricted.",
          attributes: ["relaxed fit", "quick dry"],
          icon: "🩳",
        },
        {
          id: "performance-cap",
          label: "Performance Cap",
          category: "Accessories",
          description: "Shields sun without trapping heat.",
          attributes: ["packable", "sweat-wicking"],
          icon: "🧢",
        },
      ],
      attributes: [
        { label: "Breathability", value: "High airflow fabric" },
        { label: "Layering", value: "Single-layer heat setup" },
        { label: "Fit", value: "Relaxed top, free-moving bottom" },
      ],
      why: [
        "Fits hot conditions",
        "Keeps effort low and comfortable",
        { tags: ["quick-dry", "anti-chafe", "easy-pace"] },
      ],
    },
    brands: {
      filterTags: ["hot-weather", "easy-run", "quick-dry"],
      items: [
        {
          id: "janji",
          name: "Janji",
          rank: 1,
          score: 92,
          summary: "Breathable warm-weather pieces with quick-dry fabrics.",
          tags: ["hot-weather", "quick-dry", "sun-coverage"],
          why: "Useful for humid runs where moisture management matters.",
        },
        {
          id: "rabbit",
          name: "Rabbit",
          rank: 2,
          score: 88,
          summary: "Soft daily-run staples that balance comfort and airflow.",
          tags: ["easy-run", "soft-handfeel", "lightweight"],
          why: "Matches the relaxed effort and comfort-first outfit profile.",
        },
        {
          id: "tracksmith",
          name: "Tracksmith",
          rank: 3,
          score: 84,
          summary: "Lightweight performance staples with classic daily-run fits.",
          tags: ["easy-run", "lightweight", "performance-fit"],
          why: "Pairs well with simple, breathable warm-weather layers.",
        },
      ],
    },
    stats: {
      savedOutfits: 12,
      brandsTracked: 5,
      accuracyPercent: 98,
    },
  },
  long: {
    recommendation: {
      title: "Recommended Outfit for a Long Run",
      tags: [
        { label: "Hot", tone: "weather" },
        { label: "Long Run", tone: "workout" },
        { label: "Storage", tone: "attribute" },
      ],
      items: [
        {
          id: "vented-tee",
          label: "Vented Running Tee",
          category: "Top",
          description: "Light coverage with mesh panels for sustained heat release.",
          attributes: ["breathable", "sun coverage"],
          icon: "👕",
        },
        {
          id: "half-tights",
          label: "Pocket Half Tights",
          category: "Bottom",
          description: "Secure storage for gels and keys without bounce.",
          attributes: ["phone pocket", "anti-chafe"],
          icon: "🩳",
        },
        {
          id: "hydration-belt",
          label: "Hydration Belt",
          category: "Accessories",
          description: "Carries fluids for humid miles.",
          attributes: ["hydration", "bounce-free"],
          icon: "🎽",
        },
      ],
      attributes: [
        { label: "Breathability", value: "Mesh ventilation for longer exposure" },
        { label: "Layering", value: "Sun coverage without heavy fabric" },
        { label: "Fit", value: "Secure pockets and low-bounce accessories" },
      ],
      why: [
        "Supports longer time in hot conditions",
        "Adds storage and hydration capacity",
        { tags: ["hydration", "secure-storage", "anti-chafe"] },
      ],
    },
    brands: {
      filterTags: ["long-run", "hydration", "secure-storage"],
      items: [
        {
          id: "janji",
          name: "Janji",
          rank: 1,
          score: 93,
          summary: "Distance-ready apparel with practical storage options.",
          tags: ["long-run", "secure-storage", "quick-dry"],
          why: "Strong fit for long efforts where pockets and drying speed matter.",
        },
        {
          id: "nathan",
          name: "Nathan",
          rank: 2,
          score: 90,
          summary: "Hydration accessories built around long-run fueling needs.",
          tags: ["long-run", "hydration", "accessories"],
          why: "Adds reliable fluid carry for humid long runs.",
        },
        {
          id: "saysky",
          name: "SAYSKY",
          rank: 3,
          score: 85,
          summary: "Lightweight pieces with secure fits for steady mileage.",
          tags: ["long-run", "performance-fit", "lightweight"],
          why: "Works well with low-bounce long-run kit choices.",
        },
      ],
    },
    stats: {
      savedOutfits: 16,
      brandsTracked: 7,
      accuracyPercent: 96,
    },
  },
  intervals: {
    recommendation: {
      title: "Recommended Outfit for Intervals",
      tags: [
        { label: "Hot", tone: "weather" },
        { label: "Intervals", tone: "workout" },
        { label: "Race Fit", tone: "attribute" },
      ],
      items: [
        {
          id: "race-singlet",
          label: "Race Singlet",
          category: "Top",
          description: "Featherweight top for higher output reps.",
          attributes: ["high airflow", "race fit"],
          icon: "👕",
        },
        {
          id: "split-racing-shorts",
          label: "Split Racing Shorts",
          category: "Bottom",
          description: "Minimal fabric for unrestricted turnover.",
          attributes: ["lightweight", "quick dry"],
          icon: "🩳",
        },
        {
          id: "cooling-headband",
          label: "Cooling Headband",
          category: "Accessories",
          description: "Keeps sweat controlled during faster work.",
          attributes: ["sweat-wicking", "low profile"],
          icon: "🏃",
        },
      ],
      attributes: [
        { label: "Breathability", value: "Maximum airflow for hard reps" },
        { label: "Layering", value: "Minimal race-weight setup" },
        { label: "Fit", value: "Trim and low-distraction" },
      ],
      why: [
        "Built for faster turnover",
        "Limits fabric weight in hot intervals",
        { tags: ["race-fit", "quick-dry", "high-output"] },
      ],
    },
    brands: {
      filterTags: ["tempo", "race-fit", "quick-dry"],
      items: [
        {
          id: "tracksmith",
          name: "Tracksmith",
          rank: 1,
          score: 94,
          summary: "Lightweight performance staples with race-day fits.",
          tags: ["tempo", "lightweight", "race-fit"],
          why: "Matches the interval content and fast-moving outfit profile.",
        },
        {
          id: "satisfy",
          name: "Satisfy",
          rank: 2,
          score: 89,
          summary: "Premium run gear focused on freedom of movement.",
          tags: ["anti-chafe", "tempo", "lightweight"],
          why: "Pairs with split shorts and low-friction hot-weather layers.",
        },
        {
          id: "bandit",
          name: "Bandit",
          rank: 3,
          score: 86,
          summary: "Race-oriented apparel with technical fabrics and sharp fits.",
          tags: ["race-fit", "quick-dry", "high-output"],
          why: "Works for harder sessions where fit and moisture control matter.",
        },
      ],
    },
    stats: {
      savedOutfits: 9,
      brandsTracked: 6,
      accuracyPercent: 97,
    },
  },
} satisfies Record<RunType, {
  recommendation: unknown;
  brands: unknown;
  stats: unknown;
}>;

function getRunType(request: Request): RunType {
    const { searchParams } = new URL(request.url);
    const runType = searchParams.get("runType") ?? "easy";

    return validRunTypes.has(runType as RunType) ? (runType as RunType) : "easy";
}

type SessionUserWithLocation = NonNullable<Awaited<ReturnType<typeof getSessionUser>>> & {
  location?: string | null;
};

type DashboardWeather = {
  location: string;
  temperature: number;
  feelsLike: number;
  condition: string;
  humidity: number;
  precipitationChance: number;
  windSpeed: number;
  uvIndex: number;
  impactLabel: string;
  labels: string[];
  recommendationNote: string;
};

function getSavedLocation(user: SessionUserWithLocation) {
  return user.location?.trim() || "St. Petersburg, FL";
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

    const location = getSavedLocation(user as SessionUserWithLocation);
    const runType = getRunType(request);
    const runData = runTypeData[runType];
    const weather = await getDashboardWeather(location);

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