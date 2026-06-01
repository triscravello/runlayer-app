import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getRecommendationHistory } from "@/services/recommendationServerService";

export const runtime = "nodejs";

export async function GET(request: Request) {
    try {
        const sessionUser = await getSessionUser();
        const { searchParams } = new URL(request.url);
        const userId = sessionUser?.id ?? searchParams.get("userId");

        if (!userId) {
            return NextResponse.json({ error: "Missing userId" }, { status: 400 });
        }

        const limitParam = Number(searchParams.get("limit") ?? "20");
        const offsetParam = Number(searchParams.get("offset") ?? "0");
        const history = await getRecommendationHistory(userId, {
            limit: Number.isFinite(limitParam) ? limitParam : 20,
            offset: Number.isFinite(offsetParam) ? offsetParam : 0,
        });

        return NextResponse.json(history);
    } catch (error) {
        console.error("Error fetching recommendation history:", error);
        return NextResponse.json({ error: "Failed to fetch recommendation history" }, { status: 500 });
    }
}