#!/usr/bin/env bash
# Pre-launch smoke test — run this before handing off to BCG.
# Usage: ./scripts/smoke-test.sh https://your-app.vercel.app
# All three health endpoints must pass for a green result.

set -euo pipefail

BASE_URL="${1:-}"
if [[ -z "$BASE_URL" ]]; then
  echo "Usage: ./scripts/smoke-test.sh <base-url>"
  echo "  e.g. ./scripts/smoke-test.sh https://amerivet-benefits.vercel.app"
  exit 1
fi

BASE_URL="${BASE_URL%/}"  # strip trailing slash

PASS=0
FAIL=0

check() {
  local label="$1"
  local url="$2"
  local expect_field="$3"   # jq path to check for a truthy value
  local expect_value="$4"   # expected string value (optional, "" = just truthy)

  printf "  %-35s" "$label"
  local http_code
  local body
  body=$(curl -sf --max-time 15 -w "\n%{http_code}" "$url" 2>/dev/null) || { echo "FAIL  (connection refused / timeout)"; ((FAIL++)); return; }
  http_code=$(echo "$body" | tail -1)
  body=$(echo "$body" | sed '$d')

  if [[ "$http_code" -ge 400 ]]; then
    echo "FAIL  (HTTP $http_code)"
    echo "        $(echo "$body" | head -c 200)"
    ((FAIL++))
    return
  fi

  if [[ -n "$expect_field" ]]; then
    local actual
    actual=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); v=$expect_field; print(str(v).lower())" 2>/dev/null || echo "parse-error")
    if [[ "$actual" == "parse-error" ]]; then
      echo "FAIL  (could not parse JSON)"
      ((FAIL++))
      return
    fi
    if [[ -n "$expect_value" && "$actual" != "$expect_value" ]]; then
      echo "FAIL  (got: $actual, want: $expect_value)"
      ((FAIL++))
      return
    fi
    if [[ "$actual" == "false" || "$actual" == "none" || "$actual" == "0" ]]; then
      echo "FAIL  ($expect_field = $actual)"
      ((FAIL++))
      return
    fi
  fi

  echo "PASS  (HTTP $http_code)"
  ((PASS++))
}

echo ""
echo "Smoke test: $BASE_URL"
echo "──────────────────────────────────────────────────"

echo ""
echo "1. Base health"
check "/api/health — status ok"            "$BASE_URL/api/health"                  "d.get('status')"         "ok"
check "/api/health — OpenAI configured"    "$BASE_URL/api/health"                  "d['services']['openai']['configured']" "true"
check "/api/health — Redis available"      "$BASE_URL/api/health"                  "d['services']['redis']['available']"   "true"

echo ""
echo "2. Search health"
check "/api/health/search — reachable"     "$BASE_URL/api/health/search"           "d.get('status')"         ""
check "/api/health/search — amerivet docs" "$BASE_URL/api/health/search"           "d['checks']['filteredQuery']['status']" "healthy"

echo ""
echo "3. Session / Redis health"
check "/api/health/session — Redis pong"   "$BASE_URL/api/health/session"          "d['redis']['ping']"      "pong"
check "/api/health/session — round-trip"   "$BASE_URL/api/health/session"          "d['redis']['roundTripOk']" "true"
check "/api/health/session — store ok"     "$BASE_URL/api/health/session"          "d['sessionStore']['ok']"   "true"

echo ""
echo "──────────────────────────────────────────────────"
echo "  PASSED: $PASS    FAILED: $FAIL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "NOT READY — fix the failures above before handing off."
  exit 1
else
  echo "ALL CLEAR — ready for BCG handoff."
  exit 0
fi
