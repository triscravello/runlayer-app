import type { TempCategory } from "@/services/weatherService";

type OpenWeatherCondition = {
  main?: string;
}

type OpenWeatherResponse = {
  name?: string;
  main?: {
    temp?: number;
    humidity?: number;
  };
  wind?: {
    speed?: number;
  };
  weather?: OpenWeatherCondition[];
  rain?: unknown;
  uvi?: number;
};

type NormalizedOpenWeather = {
  location: string;
  tempF: number;
  humidity: number;
  windSpeed: number;
  precipitationChance: number;
  uvIndex: number;
  condition: string;
  tempCategory: TempCategory;
};

export const weatherNormalizer = {
  normalize(raw: OpenWeatherResponse): NormalizedOpenWeather {
    const tempF = raw.main?.temp ?? 0;
    const humidity = raw.main?.humidity ?? 0;
    const windSpeed = raw.wind?.speed ?? 0;
    const condition = raw.weather?.[0]?.main || "Unknown";

    return {
      location: raw.name ?? "Unknown",
      tempF,
      humidity,
      windSpeed,
      precipitationChance: this.estimatePrecip(raw),
      uvIndex: raw.uvi ?? 0,
      condition,
      tempCategory: this.getTempCategory(tempF),
    };
  },

  getTempCategory(tempF: number): TempCategory {
    if (tempF <= 45) return "cold";
    if (tempF <= 60) return "cool";
    if (tempF <= 75) return "mild";
    if (tempF <= 88) return "warm";
    return "hot";
  },

  estimatePrecip(raw: OpenWeatherResponse) {
    if (raw.rain) return 0.7;
    if (raw.weather?.[0]?.main === "Rain") return 0.6;
    return 0.1;
  },
};