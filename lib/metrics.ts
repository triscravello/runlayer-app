import client from 'prom-client';

// Create an isolated registry (not the global default)
export const registry = new client.Registry();

// Collect Node.js runtime metrics with a runlayer_ prefix
client.collectDefaultMetrics({ register: registry, prefix: 'runlayer_' });

// Histogram: tracks how long each request takes
export const httpRequestDuration = new client.Histogram({
  name: 'runlayer_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['route', 'method'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

// Counter: total requests processed, broken down by route/method/status
export const httpRequestsTotal = new client.Counter({
  name: 'runlayer_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['route', 'method', 'status_code'] as const,
  registers: [registry],
});

// Counter: tracks when rate limiting rejects a request
export const rateLimitHitsTotal = new client.Counter({
  name: 'runlayer_rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['route'] as const,
  registers: [registry],
});

// Counter: tracks authentication failures with a reason label
export const authFailuresTotal = new client.Counter({
  name: 'runlayer_auth_failures_total',
  help: 'Total number of authentication failures',
  labelNames: ['route', 'reason'] as const,
  registers: [registry],
});

// Counter: tracks how many recommendations are served
export const recommendationsTotal = new client.Counter({
  name: 'runlayer_recommendations_total',
  help: 'Total number of recommendations served',
  registers: [registry],
});

// Gauge: tracks how many requests are currently being processed
export const activeRequests = new client.Gauge({
  name: 'runlayer_active_requests',
  help: 'Number of currently active requests',
  registers: [registry],
});