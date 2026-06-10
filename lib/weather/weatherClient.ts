import { BadRequestError, HttpError } from "../http/apiErrors";

export const weatherClient = {
    async fetchWeather(location: string) {
        const apiKey = process.env.WEATHER_API_KEY;

        if (!apiKey) {
            throw new Error("Missing WEATHER_API_KEY");
        }

        const params = new URLSearchParams({
            q: location,
            units: "imperial",
            appid: apiKey,
        });

        const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?${params.toString()}`);

        if (!res.ok) {
            if (res.status === 404) {
                throw new BadRequestError("Weather location not found");
            }

            throw new HttpError(res.status, "Weather provider request failed", "WEATHER_PROVIDER_ERROR");
        }

        return res.json();
    }
}