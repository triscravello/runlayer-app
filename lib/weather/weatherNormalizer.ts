import type { TempCategory } from "@/services/weatherService";

export const weatherNormalizer = {
  normalize(raw: any): {
    location: string;
    tempF: number;
    humidity: number;
    windSpeed: number;
    precipitationChance: number;
    uvIndex: number;
    condition: string;
    tempCategory: TempCategory;
  } {
    const tempF = raw.main.temp;
    const humidity = raw.main.humidity;
    const windSpeed = raw.wind.speed;
    const condition = raw.weather?.[0]?.main || "Unknown";

    return {
      location: raw.name,
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

  estimatePrecip(raw: any) {
    if (raw.rain) return 0.7;
    if (raw.weather?.[0]?.main === "Rain") return 0.6;
    return 0.1;
  },
};