"use client";

import { useCallback, useEffect, useState } from "react";
import { weatherService, type NormalizedWeather } from "@/services/weatherService";

type UseWeatherResult = {
    weather: NormalizedWeather | null;
    isLoading: boolean;
    error: string;
    fetchWeather: (nextLocation?: string) => Promise<NormalizedWeather | null>;
}

function getErrorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
}

export function useWeather(location?: string): UseWeatherResult {
    const [weather, setWeather] = useState<NormalizedWeather | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    const fetchWeather = useCallback(
        async (nextLocation = location) => {
            if (!nextLocation) {
                setWeather(null);
                return null;
            }

            setIsLoading(true);
            setError("");

            try {
                const nextWeather = await weatherService.getWeather(nextLocation);
                setWeather(nextWeather);
                return nextWeather;
            } catch (err) {
                setError(getErrorMessage(err, "Unable to load weather."));
                return null; 
            } finally {
                setIsLoading(false);
            }
        },
        [location],
    );

    useEffect(() => {
        if (!location) {
            return;
        }

        const activeLocation = location;
        const controller = new AbortController();

        async function loadWeather() {
            setIsLoading(true);
            setError("");

            try {
                const nextWeather = await weatherService.getWeather(activeLocation, {
                    signal: controller.signal,
                });
                setWeather(nextWeather);
            } catch (err) {
                if (!isAbortError(err)) {
                    setError(getErrorMessage(err, "Unable to load weather."));
                }
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            }
        }

        loadWeather();

        return () => controller.abort();
    }, [location]);

    return {
        weather: location ? weather : null,
        isLoading,
        error,
        fetchWeather,
    };
}