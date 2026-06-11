import { BadRequestError, HttpError } from "../http/apiErrors";

const US_STATE_ABBREVIATIONS = new Set([
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "FL",
    "GA",
    "HI",
    "IA",
    "ID",
    "IL",
    "IN",
    "KS",
    "KY",
    "LA",
    "MA",
    "MD",
    "ME",
    "MI",
    "MN",
    "MO",
    "MS",
    "MT",
    "NC",
    "ND",
    "NE",
    "NH",
    "NJ",
    "NM",
    "NV",
    "NY",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VA",
    "VT",
    "WA",
    "WI",
    "WV",
    "WY",
    "DC",
]);

export function normalizeLocationQuery(location: string): string {
    const trimmedLocation = location.trim();
    const cityStateMatch = trimmedLocation.match(/^(.+?)\s*,\s*([A-Za-z]{2})$/);

    if (cityStateMatch) {
        const [, city, state] = cityStateMatch;
        const normalizedState = state.toUpperCase();

        if (US_STATE_ABBREVIATIONS.has(normalizedState)) {
            return `${city.trim()}, ${normalizedState}, US`;
        }
    }

    return trimmedLocation.split(",").map((locationPart) => locationPart.trim()).join(",");
}

export const weatherClient = {
    async fetchWeather(location: string) {
        const apiKey = process.env.WEATHER_API_KEY;

        if (!apiKey) {
            throw new Error("Missing WEATHER_API_KEY");
        }

        const normalizedLocation = normalizeLocationQuery(location);

        console.log(`[weatherClient] normalized location query: ${normalizedLocation}`);

        const params = new URLSearchParams({
            q: normalizedLocation,
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