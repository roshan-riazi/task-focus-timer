#!/bin/sh
# VPS smoke (issue 19, RUNBOOK §2): login, 1-minute focus, history/analytics
# render, health 200 — against the compose stack. Mirrors the Playwright
# journey seams with curl so a bare VPS host can run it (needs curl+python3).
# Env: APP_URL (default http://localhost:3000), SMOKE_EMAIL, SMOKE_PASSWORD.
set -eu

APP_URL="${APP_URL:-http://localhost:3000}"
SMOKE_EMAIL="${SMOKE_EMAIL:-smoke-$(date -u +%Y%m%dT%H%M%SZ)@example.com}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-smoke-pass-01}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT INT TERM

fail() { echo "[smoke] FAIL: $1" >&2; exit 1; }
pass() { echo "[smoke] ok: $1"; }

echo "[smoke] target $APP_URL as $SMOKE_EMAIL"

HEALTH="$(curl -fsS "$APP_URL/api/health")"
echo "$HEALTH" | grep -q '"status":"ok"' || fail "health envelope not ok: $HEALTH"
pass "health 200 with db:up"

curl -fsS -c "$COOKIE_JAR" -H 'Content-Type: application/json' -H "Origin: $APP_URL" \
  -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}" \
  "$APP_URL/api/auth/register" >/dev/null 2>&1 \
  || curl -fsS -c "$COOKIE_JAR" -H 'Content-Type: application/json' -H "Origin: $APP_URL" \
    -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}" \
    "$APP_URL/api/auth/login" >/dev/null || fail "register/login"
pass "login (register-or-login)"

# 1-minute focus: shrink the focus duration for this user, then start/complete.
curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -H "Origin: $APP_URL" \
  -X PATCH -d '{"focusDurationSeconds":60}' "$APP_URL/api/settings" >/dev/null \
  || fail "settings PATCH (1-minute focus)"
pass "settings cutover to 1-minute focus"

TASK_RES="$(curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -H "Origin: $APP_URL" \
  -d '{"title":"smoke focus task"}' "$APP_URL/api/tasks")" || fail "task create"
TASK_ID="$(printf '%s' "$TASK_RES" | python3 -c 'import json,sys; print(json.load(sys.stdin)["task"]["id"])')" \
  || fail "task id parse"
pass "task create"

START_RES="$(curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -H "Origin: $APP_URL" \
  -d "{\"intervalType\":\"focus\",\"taskId\":\"$TASK_ID\"}" "$APP_URL/api/timer/start")" \
  || fail "timer start"
echo "$START_RES" | grep -q '"status":"running"' || fail "timer not running: $START_RES"
pass "1-minute focus start"

sleep 65
# Unique key per run: a static key would replay the first completion on
# repeat runs instead of completing the new timer (finalize idempotency).
IDEMPOTENCY_KEY="smoke-complete-$(date -u +%Y%m%dT%H%M%SZ)-$$"
curl -fsS -b "$COOKIE_JAR" -H 'Content-Type: application/json' -H "Origin: $APP_URL" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -X POST "$APP_URL/api/timer/complete" >/dev/null || fail "timer complete"
pass "focus complete"

curl -fsS -b "$COOKIE_JAR" "$APP_URL/api/sessions?limit=5" | grep -q 'focus' \
  || fail "history render"
pass "history render"

curl -fsS -b "$COOKIE_JAR" "$APP_URL/api/analytics/summary?period=today" | grep -q 'completed' \
  || fail "analytics render"
pass "analytics render"

echo "[smoke] PASS: login, 1-min focus, history/analytics, health 200."
