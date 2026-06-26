import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/auth/api";
import { generateGearRecommendations } from "@/services/recommendationServerService";
import { parseJsonBody } from "@/lib/http/validation";
import type { UserInput } from "@/lib/engine/recommendationEngine";


export const runtime = "nodejs";

const recommendationInputSchema = z.object({
    userId: z.string().optional(),
    weather: z.enum(["hot", "warm", "cold", "rain", "humid", "wind"]).optional(),
    intensity: z.enum(["recovery", "easy", "long-run", "tempo", "intervals", "race"]).optional(),
    workoutType: z.string().optional(),
    terrain: z.enum(["road", "trail", "treadmill"]).optional(),
    category: z.enum(["top", "bottom", "accessory", "outerwear", "socks", "hat", "gloves", "all"]).optional(),
})

export const POST = withAuth(async (request: NextRequest, _context, user) => {
    const body = await parseJsonBody<UserInput>(request, recommendationInputSchema);
    const recommendations = await generateGearRecommendations({ ...body, userId: user.id }, undefined, user.id);

    return NextResponse.json(recommendations);
});