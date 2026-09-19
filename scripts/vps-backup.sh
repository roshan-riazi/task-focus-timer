#!/bin/sh
# VPS backup (issue 19, RUNBOOK §4): scheduled `pg_dump` with the published
# 30-day expiry. Keeps the same retention story as account/task deletion
# evidence (backups age out in 30 days — never purged early, never restored
# over live data as a test; see vps-restore-drill.sh).
# Usage: BACKUP_DIR=./backups ./scripts/vps-backup.sh
# Cron: 0 3 * * * cd /srv/focusflow && ./scripts/vps-backup.sh >>var/log/backup.log 2>&1
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS=30
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/focusflow-$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
echo "[backup] dumping live DB to $FILE…"
docker compose exec -T db pg_dump -U focusflow -d focusflow | gzip > "$FILE"
echo "[backup] wrote $FILE ($(du -h "$FILE" | cut -f1))."

echo "[backup] pruning artifacts strictly older than $RETENTION_DAYS days…"
# Minute granularity (-mmin) matches lib/ops/backup-retention.ts ms-exact
# cutoff; day-granular `-mtime +30` would effectively keep 31 days.
find "$BACKUP_DIR" -maxdepth 1 -name 'focusflow-*.sql.gz' -mmin +"$((RETENTION_DAYS * 24 * 60))" -print -delete

echo "[backup] done. Current artifacts:"
ls -lh "$BACKUP_DIR" | tail -n 10
