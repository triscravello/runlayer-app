import { weatherClient } from "@/lib/weather/weatherClient";
import { weatherNormalizer } from "@/lib/weather/weatherNormalizer";
import type { NormalizedWeather } from "./weatherService";

export async function getWeather(location: string): Promise<NormalizedWeather> {
    const rawWeather = await weatherClient.fetchWeather(location);
    return weatherNormalizer.normalize(rawWeather);
}