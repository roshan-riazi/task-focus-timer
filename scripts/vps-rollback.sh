#!/bin/sh
# VPS forward-only rollback (issue 19, RUNBOOK §3): re-tag the previous image
# and re-run compose. Migrations are NEVER rolled back — schema changes must
# be backward-compatible for one release (expand, backfill, then contract),
# so a rollback past a migration needs a compensating migration.
# Usage: ./scripts/vps-rollback.sh <previous-git-sha-or-tag>
set -eu

PREVIOUS="${1:-}"
if [ -z "$PREVIOUS" ]; then
  echo "usage: $0 <previous-git-sha-or-tag>" >&2
  exit 2
fi

: "${AUTH_SECRET:?Set AUTH_SECRET in your shell or a .env file — never commit secrets.}"
export IMAGE_TAG="$PREVIOUS"

echo "[rollback] re-running compose with the pinned prior artifact focusflow:$PREVIOUS…"
echo "[rollback] NOTE: forward-only — no 'migrate reset' against shared data."
echo "[rollback] (--no-build: the tag IS the artifact; a rebuild would defeat the pin.)"
docker compose up -d --no-build

echo "[rollback] waiting for /api/health…"
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
    echo "[rollback] healthy on $PREVIOUS."
    exit 0
  fi
  if [ "$i" -eq 30 ]; then
    echo "[rollback] health check never passed" >&2
    docker compose logs --tail=50 app
    exit 1
  fi
  sleep 2
done
