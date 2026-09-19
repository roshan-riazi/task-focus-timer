#!/bin/sh
# Host health monitor for VPS `/api/health` (issue 19, RUNBOOK §6 triage).
# One-shot probe (cron/systemd-timer friendly): logs timestamp + status, exits
# non-zero when down so the supervisor alerts. No user data is ever logged.
# Usage: ./scripts/vps-health-monitor.sh [url]
# Cron: * * * * * /srv/focusflow/scripts/vps-health-monitor.sh >>/var/log/focusflow-health.log 2>&1
set -eu

URL="${1:-${APP_URL:-http://localhost:3000}/api/health}"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if BODY="$(curl -fsS -m 10 "$URL" 2>/dev/null)"; then
  case "$BODY" in
    *'"status":"ok"'*'"db":"up"'*)
      echo "$STAMP health=up url=$URL"
      exit 0
      ;;
    *)
      echo "$STAMP health=degraded url=$URL body=$BODY" >&2
      exit 1
      ;;
  esac
else
  echo "$STAMP health=down url=$URL" >&2
  exit 1
fi
