#!/bin/sh
# VPS deploy (issue 19, RUNBOOK §2): build the standalone image pinned by git
# sha, bring up compose (entrypoint runs `migrate deploy`), then smoke it.
# Usage: ./scripts/vps-deploy.sh [--skip-smoke]
# Env: AUTH_SECRET (required), APP_URL, IMAGE_TAG override, REGISTRY prefix.
set -eu

SKIP_SMOKE=0
for arg in "$@"; do
  case "$arg" in
    --skip-smoke) SKIP_SMOKE=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

: "${AUTH_SECRET:?Set AUTH_SECRET in your shell or a .env file — never commit secrets.}"
SHA="$(git rev-parse --short HEAD)"
REGISTRY="${REGISTRY:-}"
IMAGE_TAG="${IMAGE_TAG:-$SHA}"
export IMAGE_TAG

if [ -n "$REGISTRY" ]; then
  IMAGE="$REGISTRY/focusflow:$IMAGE_TAG"
  echo "[deploy] building $IMAGE…"
  docker build -t "$IMAGE" .
  echo "[deploy] pushing $IMAGE…"
  docker push "$IMAGE"
  echo "[deploy] pulling on host…"
  docker pull "$IMAGE"
else
  echo "[deploy] building focusflow:$IMAGE_TAG…"
  docker build -t "focusflow:$IMAGE_TAG" .
fi

echo "[deploy] composing up (entrypoint migrates, no rebuild — the tag IS the artifact)…"
docker compose up -d --no-build

echo "[deploy] waiting for /api/health…"
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
    echo "[deploy] healthy."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[deploy] health check never passed" >&2
    docker compose ps
    docker compose logs --tail=50 app
    exit 1
  fi
  sleep 2
done

if [ "$SKIP_SMOKE" -eq 0 ]; then
  echo "[deploy] running smoke…"
  ./scripts/vps-smoke.sh
fi

echo "[deploy] done: image focusflow:$IMAGE_TAG green."
echo "[deploy] rollback: ./scripts/vps-rollback.sh <previous-sha> (forward-only migrations — never reset)."
