import http from 'k6/http';
import { check, sleep } from 'k6';

// Test configuration: ramp to 1 VU, hold, then ramp down 
export const options = {
    stages: [
        { duration: '5s', target: 1 },
        { duration: '20s', target: 1 },
        { duration: '5s', target: 0 },
    ],
    // Automated pass/fail thresholds
    thresholds: {
        http_req_duration: ['p(95)<500'],
        http_req_failed: ['rate<0.01'],
    },
};

export default function() {
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
            tempCategory: "warm"
        }
    });
    
    const params = {
        headers: {
            "Content-Type": "application/json",
            Cookie: __ENV.RUNLAYER_COOKIE
        },
    };

    // Send a POST request to the recommend endpoint
    const res = http.post('http://localhost:3000/api/recommend', payload, params);
    console.log(`status=${res.status} body=${res.body}`);

    // validate the response is correct, not just fast
    check(res, {
        'status is 200': (r) => r.status === 200,
        'response body is not empty': (r) => r.body.length > 0,
    });

    // pause between iterations to simulate realistic pacing
    sleep(1);
}