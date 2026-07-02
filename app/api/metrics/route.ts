import { NextResponse } from "next/server";
import { registry } from "@/lib/metrics";

// Prevent Next.js from caching the metrics response
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET() {
    // Gather all registered metrics in Prometheus exposition format
    const metrics = await registry.metrics();
    return new NextResponse(metrics, {
        headers: {
            'Content-Type': registry.contentType,
        }
    });
}