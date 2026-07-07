import { NextRequest } from 'next/server';
import { createRequestLogger, logger } from './logger';
import {
  httpRequestDuration,
  httpRequestsTotal,
  rateLimitHitsTotal,
  authFailuresTotal,
  recommendationsTotal,
  activeRequests,
} from './metrics';

// Define the shape of a Next.js route handler
type RouteHandler = (request: NextRequest, context: object) => Promise<Response>;

// Higher-order function that wraps any route handler with instrumentation
export function withInstrumentation(handler: RouteHandler, routeName: string): RouteHandler {
  return async (request: NextRequest, context: object) => {
    // Generate a unique ID to correlate all logs for this request
    const requestId = crypto.randomUUID();
    const method = request.method;
    const log = createRequestLogger(requestId, routeName, method);

    // Start a high-resolution timer for duration tracking
    const startTime = process.hrtime.bigint();
    activeRequests.inc();

    log.info('Request started');

    // Default to 500 so unhandled errors still get counted
    let statusCode = 500;

    try {
      const response = await handler(request, context);
      statusCode = response.status;
      return response;
    } catch (error) {
      log.error('Request failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    } finally {
      // Finally block runs whether the request succeeded or failed
      const durationNs = process.hrtime.bigint() - startTime;
      const durationSeconds = Number(durationNs) / 1e9;

      activeRequests.dec();
      httpRequestDuration.observe({ route: routeName, method }, durationSeconds);
      httpRequestsTotal.inc({ route: routeName, method, status_code: String(statusCode) });

      log.info('Request completed', { statusCode, durationMs: Math.round(durationSeconds * 1000) });
    }
  };
}

// Domain-specific helpers that route handlers call explicitly
export function recordRateLimitHit(route: string): void {
    rateLimitHitsTotal.inc({ route });
    logger.warn('Rate limit hit', { route });
}

export function recordAuthFailure(route: string, reason: string): void {
    authFailuresTotal.inc({ route, reason });
    logger.warn('Authentication failure', { route, reason });
}

export function recordRecommendation(): void {
    recommendationsTotal.inc();
}