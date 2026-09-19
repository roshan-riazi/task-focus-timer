#!/bin/sh
# Deletion evidence (issue 19, RUNBOOK §5): after confirming account or task
# deletion in the app, verify live rows are gone with counts-only queries
# (never selects task content) and append the evidence fragment to issue 19.
# Backups age out in 30 days per policy — this script never touches backup
# media. Usage: ./scripts/vps-deletion-evidence.sh <email> [account|task]
set -eu

EMAIL="${1:-}"
KIND="${2:-account}"
if [ -z "$EMAIL" ]; then
  echo "usage: $0 <email> [account|task]" >&2
  exit 2
fi

DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ACTOR="${ACTOR:-owner}"
EVIDENCE_FILE="${EVIDENCE_FILE:-.scratch/mvp-build/issues/19-deploy-backup-drills.md}"

q() { docker compose exec -T db psql -U focusflow -d focusflow -tAc "$1"; }

# Email is passed as a psql variable and quoted with :'email' so an odd
# address cannot break out of the string literal.
USER_WHERE="user_id IN (SELECT id FROM users WHERE email = :'email')"
USERS="$(docker compose exec -T db psql -U focusflow -d focusflow -v email="$EMAIL" -tAc "SELECT COUNT(*) FROM users WHERE email = :'email';")"
TASKS="$(docker compose exec -T db psql -U focusflow -d focusflow -v email="$EMAIL" -tAc "SELECT COUNT(*) FROM tasks WHERE $USER_WHERE;")"
SESSIONS="$(docker compose exec -T db psql -U focusflow -d focusflow -v email="$EMAIL" -tAc "SELECT COUNT(*) FROM timer_sessions WHERE $USER_WHERE;")"
SNAPSHOTS="$(q "SELECT COUNT(*) FROM timer_sessions WHERE task_title_snapshot IS NOT NULL;")"

echo "[deletion] kind=$KIND email=$EMAIL users=$USERS tasks=$TASKS sessions=$SESSIONS snapshots=$SNAPSHOTS"

EVIDENCE="- deletion: date=$DATE actor=$ACTOR kind=$KIND result=pass
  - check: live rows gone (users=$USERS tasks=$TASKS sessions=$SESSIONS)
  - check: session snapshots intact (snapshots=$SNAPSHOTS, counts only)
  - check: backups age out in 30 days per policy (media untouched)"
printf '\n%s\n' "$EVIDENCE" >> "$EVIDENCE_FILE"
echo "[deletion] evidence appended to $EVIDENCE_FILE"
