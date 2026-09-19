#!/bin/sh
# VPS container entrypoint (issue 19): fail closed on missing secrets,
# apply repeatable forward-only migrations, then start the standalone server.
# Never runs `migrate reset` — rollbacks are forward-only per RUNBOOK §3.
set -eu

: "${DATABASE_URL:?Set DATABASE_URL in the host env file — never commit secrets.}"
: "${AUTH_SECRET:?Set AUTH_SECRET in the host env file — never commit secrets.}"

echo "[entrypoint] applying Prisma migrations (migrate deploy)…"
node ./node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] starting Next.js standalone server…"
exec node server.js
