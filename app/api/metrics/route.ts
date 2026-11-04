import { handleMetricsRequest } from "@/lib/http/metricsAuth";
import { registry } from "@/lib/metrics";

// Prevent Next.js from caching the metrics response
export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Requires "Authorization: Bearer <METRICS_TOKEN>". Without a (valid) METRICS_TOKEN the endpoint is open only
// when NODE_ENV=development and returns 404 everywhere else. See lib/http/metricsAuth.ts.
export async function GET(request: Request) {
    return handleMetricsRequest(request, {
        env: process.env,
        // Gather all registered metrics in Prometheus exposition format
        metrics: () => registry.metrics(),
        contentType: registry.contentType,
    });
}
