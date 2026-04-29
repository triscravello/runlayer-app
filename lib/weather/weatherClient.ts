export const weatherClient = {
    async fetchWeather(location: string) {
        try {
            // example using OpenWeather
            const apiKey = process.env.WEATHER_API_KEY;

            const res = await fetch(
                `https://api.openweathermap.org/data/2.5/weather?q=${location}&units=imperial&appid=${apiKey}`
            )

            if (!res.ok) {
                throw new Error("Weather API request failed");
            }

            const data = await res.json();
            return data;
        } catch (error) {
            console.error("WeatherClient error:" , error);
            throw new Error("Failed to fetch weather data");
        }
    }
}