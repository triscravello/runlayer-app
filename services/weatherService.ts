// services/weatherService.ts
import { weatherClient } from "@/lib/weather/weatherClient";
import { weatherNormalizer } from "@/lib/weather/weatherNormalizer";

export type TempCategory = | "cold" | "cool" | "mild" | "warm" | "hot";

export type NormalizedWeather = {
    location: string;
    tempF: number;
    humidity: number;
    windSpeed: number;
    precipitationChance: number;
    uvIndex: number;
    condition: string;
    tempCategory: string;
};

export const weatherService = {
    async getWeather(location: string): Promise<NormalizedWeather> {
        try {
            // Fetch raw weather data
            const rawWeather = await weatherClient.fetchWeather(location);

            // Normalize into consistent internal format
            const normalized = weatherNormalizer.normalize(rawWeather);

            // Return clean object for recommendation engine
            return normalized as NormalizedWeather;
        } catch (error) {
            console.error("WeatherService error:", error);
            throw new Error("Failed to process weather data");
        }
    }
}