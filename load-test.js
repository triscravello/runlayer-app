// Usage: supply a session cookie for a local test user at runtime. Never commit a real cookie.
//   k6 run -e RUNLAYER_COOKIE="runlayer_session=<value from your browser>" load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

// Custom metric to track recommendation endpoint latency specifically
const recommendationLatency = new Trend('recommendation_latency');

export const options = {
  scenarios: {
    // Scenario 1: Users browsing recommendations (read-heavy)
    browse: {
      executor: 'ramping-vus',
      stages: [
        { duration: '15s', target: 20 },
        { duration: '30s', target: 20 },
        { duration: '5s', target: 0 },
      ],
      exec: 'browseRecommendations',
    },
    // Scenario 2: Users submitting preferences (write-heavy, starts 10s later)
    personalize: {
      executor: 'ramping-vus',
      startTime: '10s',
      stages: [
        { duration: '10s', target: 5 },
        { duration: '20s', target: 5 },
        { duration: '5s', target: 0 },
      ],
      exec: 'submitPreferences',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    recommendation_latency: ['p(95)<600'],
  },
};

export function browseRecommendations() {
  const payload = JSON.stringify({
    weather: "warm",
    intensity: "easy",
    terrain: "road",
    category: "all",
    weatherSnapshot: {
      location: "Tampa, FL",
      tempF: 78,
      feelsLikeF: 80,
      humidity: 70,
      windSpeed: 8,
      precipitationChance: 10,
      condition: "clear",
      tempCategory: "warm",
    },
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      Cookie: __ENV.RUNLAYER_COOKIE,
    },
  };

  const res = http.post(
    "http://localhost:3000/api/recommend",
    payload,
    params
  );

  // Validate response correctness, not just speed
  check(res, {
    "recommendations status 200": (r) => r.status === 200,
    "recommendations has body": (r) => r.body.length > 0,
    "recommendations is JSON": (r) =>
      r.headers["Content-Type"]?.includes("application/json"),
  });

  // Record this endpoint's latency in our custom metric
  recommendationLatency.add(res.timings.duration);

  // Random sleep between 1-3 seconds simulates realistic user pacing
  sleep(Math.random() * 2 + 1);
}

export function submitPreferences() {
    // Generate randomized preference data for each request
    const payload = JSON.stringify({
        heatTolerance: Math.floor(Math.random() * 11),
        coldTolerance: Math.floor(Math.random() * 11),
        terrainPreference: ["road", "trail", "treadmill"][Math.floor(Math.random() * 3)],
        budgetLevel: ["budget", "mid", "premium"][Math.floor(Math.random() * 3)],
        budgetSensitivity: ["low", "medium", "high"][Math.floor(Math.random() * 3)],
    });

    const params = {
        headers: {
            'Content-Type': 'application/json',
            Cookie: __ENV.RUNLAYER_COOKIE,
        },
    };

    const res = http.put('http://localhost:3000/api/profile', payload, params);

    // Accept both 200 and 201 as valid creation responses
    check(res, {
        'preferences status 200': (r) => r.status === 200 || r.status === 201,
        'preferences is JSON': (r) => r.headers['Content-Type'] && r.headers['Content-Type'].includes('application/json'),
    });

    // Longer pause simulates users filling out a form before submitting
    sleep(Math.random() * 3 + 2);
}