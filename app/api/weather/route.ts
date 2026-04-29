// app/api/weather/route.ts
import { NextResponse } from "next/server";
import { weatherService } from "@/services/weatherService";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const location = searchParams.get("location");

        if (!location) {
            return NextResponse.json(
                { error: "Missing location" },
                { status: 500 }
            );
        }

        const weather = await weatherService.getWeather(location);

        return NextResponse.json(weather);
    } catch (error) {
        console.error("Error fetching weather:", error);
        return NextResponse.json({ error: "Failed to fetch weahter" }, { status: 500 });
    }
};