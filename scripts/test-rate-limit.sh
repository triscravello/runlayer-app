#!/bin/bash
# Test rate limiting for the RunLayer API
# Run with: ./scripts/test-rate-limit.sh

BASE_URL="http://localhost:3000"

echo "=== Testing Global Rate Limit (20 requests per 10s) ==="
echo ""

for i in $(seq 1 25); do
  response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/recommend")
  if [ "$response" == "429" ]; then
    echo "Request $i: BLOCKED (429)"
  else
    echo "Request $i: OK ($response)"
  fi
done

echo ""
echo "=== Testing Auth Rate Limit (5 attempts per 60s) ==="
echo ""

for i in $(seq 1 8); do
  response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"attacker@evil.com","password":"wrong"}')
  if [ "$response" == "429" ]; then
    echo "Attempt $i: BLOCKED (429)"
  else
    echo "Attempt $i: Response ($response)"
  fi
done

echo ""
echo "=== Testing User Isolation ==="
echo ""

echo "Sending 12 requests as user_alice..."
for i in $(seq 1 12); do
  response=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "x-user-id: user_alice" "$BASE_URL/api/recommend")
  if [ "$response" == "429" ]; then
    echo "  Alice request $i: BLOCKED (429)"
  fi
done

echo "Sending 1 request as user_bob (should NOT be blocked)..."
response=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "x-user-id: user_bob" "$BASE_URL/api/recommend")
echo "  Bob request: $response"

echo ""
echo "=== Checking Rate Limit Headers ==="
echo ""

curl -s -D - "$BASE_URL/api/recommend" 2>/dev/null | grep -i "x-ratelimit\|retry-after\|HTTP/"