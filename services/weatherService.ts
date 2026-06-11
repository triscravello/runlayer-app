// services/weatherService.ts
import { readJsonResponse, type ServiceRequestOptions } from "./apiResponse";

export type TempCategory = "cold" | "cool" | "mild" | "warm" | "hot";

export type NormalizedWeather = {
    location: string;
    tempF: number;
    feelsLikeF: number;
    humidity: number;
    windSpeed: number;
    precipitationChance: number;
    uvIndex: number;
    condition: string;
    tempCategory: TempCategory;
};

export const weatherService = {
    async getWeather(location: string, options: ServiceRequestOptions = {}): Promise<NormalizedWeather> {
        const response = await fetch(`/api/weather?location=${encodeURIComponent(location)}`, {
            credentials: "include",
            signal: options.signal,
        })

        return readJsonResponse<NormalizedWeather>(response, "Unable to load weather.");
    }
};