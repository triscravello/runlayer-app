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
            let score = 0;
            let maxScore = 10;
            const reasons: string[] = []

            // Weather scoring (0-5)
            if (weather && item.weatherSuitability) {
                const value = item.weatherSuitability[weather]
                
                if (value !== undefined && value !== null) {
                    score += value * 5
                    reasons.push(`Fits ${weather} conditions`)
                } else {
                    score -= 1; // slight penalty for unknown suitability
                }
            }

            // Workout type: easy runs, intervals, long runs (0-3)
            const normalizedWorkout = workoutType?.toLowerCase();

            const matchWorkout = item.tags.some(tag => 
                tag.toLowerCase().includes(normalizedWorkout)
            );

            if (matchWorkout) {
                score += 3;
                reasons.push(`Designed for ${workoutType} runs`);
            }

            // Intensity (0-2)
            if (intensity === "high") {
                if (item.tags.includes("race-day")) {
                    score += 2;
                    reasons.push("Great for race intensity")
                } else {
                    score -= 0.5; 
                }
            }

            // Gender 
            if (item.genderTarget === gender) {
                score += 2;
                reasons.push("Perfect for gender preference");
            } else if (item.genderTarget === "unisex") {
                score += 1;
                reasons.push("Unisex fit");
            }

            const finalScore = Math.max(0, Math.min(100, (score / maxScore) * 100));

            return { item, score: finalScore, reasons };
        });

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