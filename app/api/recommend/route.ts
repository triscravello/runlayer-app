import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { generateGearRecommendations } from "@/services/recommendationServerService";
import type { UserInput } from "@/lib/engine/recommendationEngine";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as UserInput;
        const sessionUser = await getSessionUser();
        const recommendations = await generateGearRecommendations(body, undefined, sessionUser?.id ?? body.userId ?? null);

        return NextResponse.json(recommendations);
    } catch (error) {
        console.error(error);

        return NextResponse.json(
            { error: "Failed to generate recommendation" },
            { status: 500 }
        );
    }
}