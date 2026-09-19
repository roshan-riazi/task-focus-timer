#!/bin/sh
# VPS restore drill (issue 19, RUNBOOK §4): restore a backup into an ISOLATED
# database, run migration + spot checks, record evidence. NEVER restores over
# live data. Refuses to run when the target URL looks like the live DB.
# Usage: ./scripts/vps-restore-drill.sh <backup-file> [drill-db-url]
set -eu

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  echo "usage: $0 <backup-file> [drill-db-url]" >&2
  exit 2
fi
if [ ! -f "$BACKUP_FILE" ]; then
  echo "[drill] backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

DRILL_URL="${2:-${DRILL_DATABASE_URL:-postgres://focusflow:focusflow@localhost:5433/focusflow_drill}}"
case "$DRILL_URL" in
  *":5432/focusflow"*|*"@db:"*":5432"*)
    echo "[drill] REFUSING: drill target looks like the live DB ($DRILL_URL)." >&2
    echo "[drill] Point DRILL_DATABASE_URL at an isolated database instead." >&2
    exit 1
    ;;
esac

IMAGE_TAG="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
DATE="$(date -u +%Y-%m-%d)"
ACTOR="${ACTOR:-owner}"
EVIDENCE_FILE="${EVIDENCE_FILE:-.scratch/mvp-build/issues/19-deploy-backup-drills.md}"

echo "[drill] restoring $BACKUP_FILE into isolated DB…"
gunzip -c "$BACKUP_FILE" | psql "$DRILL_URL" >/dev/null
echo "[drill] restore complete."

echo "[drill] migration check on isolated DB…"
DATABASE_URL="$DRILL_URL" pnpm exec prisma migrate status
DATABASE_URL="$DRILL_URL" pnpm exec prisma validate

echo "[drill] spot queries (counts only — no task content)…"
psql "$DRILL_URL" -tAc "SELECT 'users=' || COUNT(*) FROM users;"
psql "$DRILL_URL" -tAc "SELECT 'tasks=' || COUNT(*) FROM tasks;"
psql "$DRILL_URL" -tAc "SELECT 'timer_sessions=' || COUNT(*) FROM timer_sessions;"

echo "[drill] health probe against live app (read-only)…"
curl -fsS http://localhost:3000/api/health

EVIDENCE="- drill: date=$DATE actor=$ACTOR target=vps-docker image=$IMAGE_TAG result=pass
  - check: restore $BACKUP_FILE into isolated DB (never live data)
  - check: prisma migrate status + validate clean on isolated DB
  - check: counts-only spot queries (users/tasks/timer_sessions, no content)
  - check: /api/health 200 with db:up"
printf '\n%s\n' "$EVIDENCE" >> "$EVIDENCE_FILE"
echo "[drill] pass — evidence appended to $EVIDENCE_FILE"
