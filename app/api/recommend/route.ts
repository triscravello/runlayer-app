// app/api/recommend/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type GearItem = {
    weatherSuitability: Record<string, number> | null;
    tags: string[];
    genderTarget: string | null;
}

type RankedItem = {
    item: GearItem;
    score: number;
    reasons: string[];
}

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = await req.json();

        const { weather, workoutType, intensity, gender } = body;

        const gearItems = await prisma.gearItem.findMany()

        const scored = (gearItems as GearItem[]).map((item: GearItem) => {
            let score = 0
            const reasons: string[] = []

            // Weather scoring
            if (weather && item.weatherSuitability) {
                const value = item.weatherSuitability[weather]
                if (value) {
                    score += value * 5
                    reasons.push(`Good for ${weather} weather`)
                }
            }

            // Workout type: easy runs, intervals, long runs
            if (item.tags.includes(workoutType)) {
                score += 3
                reasons.push(`Matches ${workoutType} runs`)
            }

            // Intensity
            if (intensity === "high" && item.tags.includes("race-day")) {
                score += 2
                reasons.push("Optimized for high intensity")
            }

            // Gender 
            if (item.genderTarget === gender) {
                score += 2
            } else if (item.genderTarget === "unisex") {
                score += 1
            }

            return { item, score, reasons };
        })

        const ranked = scored.sort((a: RankedItem, b: RankedItem) => b.score - a.score).slice(0, 5)

        console.log("Incoming request:", body);
        console.log("Fetched gear:", gearItems.length);
        console.log("Top result:", ranked[0]);

        return NextResponse.json({ recommendations: ranked });
    } catch (error) {
        console.error(error)
        return NextResponse.json(
            { error: "Failed to generate recommendation" },
            { status: 500 }
        )
    }
}