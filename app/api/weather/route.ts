// app/api/weather/route.ts
import { NextResponse } from "next/server";
import { BadRequestError, errorResponse } from "@/lib/http/apiErrors";
import { getWeather } from "@/services/weatherServerService";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const location = searchParams.get("location")?.trim();

        if (!location) {
            throw new BadRequestError("Missing location");
        }

        const weather = await getWeather(location);

        return NextResponse.json(weather);
    } catch (error) {
        return errorResponse(error, "Failed to fetch weather");
    }
};