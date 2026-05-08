import { NextResponse } from "next/server";
import { generateGearRecommendations } from "@/services/recommendationService";
import type { UserInput } from "@/lib/engine/recommendationEngine";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as UserInput;
        const recommendations = await generateGearRecommendations(body);

        return NextResponse.json(recommendations);
    } catch (error) {
        console.error(error);

        return NextResponse.json(
            { error: "Failed to generate recommendation" },
            { status: 500 }
        );
    }
}