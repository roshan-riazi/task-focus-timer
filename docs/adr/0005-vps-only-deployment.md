# ADR-0005: VPS-only deployment (no Vercel, no Neon)

Status: accepted (2026-09-19)

Supersedes the deployment lines of ADR-0002 ("Neon Postgres … Vercel primary
plus portable Docker"), the topology line of ADR-0001 ("Must run on Vercel
and own VPS and local"), and the Neon-backup line of ADR-0003. Everything
else in those ADRs stands.

## Context

The owner has no access to Vercel or Neon. Issue 19 originally asked for
three targets (Vercel + Neon EU, VPS Docker, local compose); only the VPS
Docker image and local compose are operable. Keeping Vercel/Neon in the docs
would leave a primary target nobody can deploy or drill.

## Decision

- Production is the owner's VPS via the portable Docker image
  (`output: standalone`, Node 26, `docker/entrypoint.sh` runs
  `prisma migrate deploy` then `node server.js`). No Vercel project.
- The database is container Postgres 16 on the same host (compose `db`
  service, `focusflow-pgdata` volume) in prod and locally. No Neon, no cloud
  history window.
- Backups are scheduled `pg_dump` artifacts with the published 30-day expiry
  (`scripts/vps-backup.sh`, `BACKUP_RETENTION_DAYS = 30` in
  `lib/ops/backup-retention.ts`). The dump directory IS the backup story.
- Drills restore into an isolated database only
  (`scripts/vps-restore-drill.sh` refuses live-DB targets); evidence is a
  content-free fragment (`lib/ops/drill-evidence.ts`) filed in issue 19.
- Health is `GET /api/health` (compose healthcheck) plus the host monitor
  (`scripts/vps-health-monitor.sh` on cron/systemd-timer). No vendor checks.
- Deploy/smoke/rollback are `scripts/vps-deploy.sh`, `scripts/vps-smoke.sh`,
  `scripts/vps-rollback.sh` — forward-only migrations, never `migrate reset`.

## Consequences

- Positive: one operable target, honest docs, no dangling cloud accounts;
  same image runs on VPS and local compose; drills work with stock Postgres
  tooling.
- Negative: single-host Postgres (no managed failover or point-in-time
  history) — acceptable at <1k users; off-host `pg_dump` copies are the
  operator's job (cron + remote sync, documented in RUNBOOK §4).
- Follow-up: stand up the host monitor and rehearse the drill once before
  beta; file the evidence in issue 19.
