# FocusFlow — Runbook

Status: accepted (2026-09-07; owner approved; 2026-09-19 VPS-only per ADR-0005)

Targets: own VPS via Docker (production) · local compose (dev).
No Vercel, no Neon, no workers, no cron vendor lock-in.
No product-analytics telemetry anywhere.

## 1. Environment matrix

| Item | VPS (prod) | Local |
| --- | --- | --- |
| App | `standalone` Docker image, pinned git-sha tag | `pnpm dev` or same image via compose |
| DB | Container Postgres 16 (`db` service, `focusflow-pgdata` volume) | Container Postgres 16 |
| Migrations | Container entrypoint `migrate deploy` (fail-closed, forward-only) | `prisma migrate dev` |
| Secrets | Host env file, never in repo | `.env.local`, never committed |
| Health | `GET /api/health` + host monitor (`scripts/vps-health-monitor.sh`) | `GET /api/health` |

Required env: `DATABASE_URL`, `AUTH_SECRET` (fail closed, no defaults for
secrets). Optional: `APP_URL` (public origin — production MUST set the public
https origin or browser mutations 403 on the CSRF gate), email provider keys,
error monitoring DSN, `LOG_LEVEL`. See `.env.example`.

## 2. Deploy

- VPS (`scripts/vps-deploy.sh`): merge to `main` → CI gates (typecheck, lint,
  audit, migrate test DB, Vitest, Playwright, Gitleaks) → build + tag image
  (`focusflow:<git-sha>`, `REGISTRY/` prefix when pushing) → `docker compose
  up -d` (entrypoint runs `prisma migrate deploy`, then `node server.js`) →
  wait for `/api/health` → smoke (`scripts/vps-smoke.sh`): login,
  start/complete a 1-minute focus, history + analytics render, `/api/health`
  200.
- Local: `pnpm install`, `docker compose up -d db`, `prisma migrate dev`,
  `pnpm dev` (or the same image via compose for parity).

## 3. Rollback

- VPS (`scripts/vps-rollback.sh <previous-sha>`): re-tag the previous image
  and re-run compose; migrations are forward-only, so a rollback past a
  migration needs a compensating migration — never `migrate reset` against
  shared data.
- Rule: schema changes must be backward-compatible for one release (expand,
  backfill, then contract) so any rollback stays readable.

## 4. Backup & restore drill

- Backups are scheduled `pg_dump` artifacts (`scripts/vps-backup.sh`, daily
  cron) with the published 30-day expiry (`BACKUP_RETENTION_DAYS = 30`,
  see `lib/ops/backup-retention.ts`): `find … -mtime +30 -delete`. The
  `db` service mounts `${BACKUP_DIR:-./backups}:/backups` so artifacts survive
  container recreation. No Neon, no cloud history window — the dump directory
  IS the backup story.
- Drill (pre-beta, then quarterly; `scripts/vps-restore-drill.sh <backup>`):
  restore into an isolated database (the script REFUSES live-DB targets),
  run `prisma migrate status` + `prisma validate` + history/analytics spot
  queries (counts only, never task content), probe live `/api/health`, and
  append the evidence fragment (`lib/ops/drill-evidence.ts`) to issue 19
  under `## Comments` (date, actor, target, image, checks, result).
  Never restore over live data as a test.

## 5. Deletion evidence (account + task)

- Account: confirm in the app → run `scripts/vps-deletion-evidence.sh
  <email> account` → verify live rows gone (user, settings, tasks, sessions,
  cycle state) via counts-only queries; record timestamp + actor in issue 19.
  Backups age out in 30 days — state this in the privacy copy; do not purge
  backup media early.
- Task: verify row gone and session snapshots (`task_title_snapshot`,
  `category_snapshot`) intact.

## 6. Incident basics (solo)

- Triage order: `/api/health` (host monitor `scripts/vps-health-monitor.sh`,
  cron `* * * * * …/vps-health-monitor.sh`) → recent deploy diff → DB
  reachability → error monitor (scrubbed, no task content) → request-ID logs.
- Error monitoring (issue 06): Sentry SDK wired on server, edge, and client
  with `ERROR_DSN`; every entrypoint shares `lib/sentry` options
  (`sendDefaultPii: false`, tracing off, `beforeSend: sentryBeforeSend` from
  `lib/errors`, derived from `lib/sensitive-fields`). `reportError` forwards
  only a type-only event (never the raw message, never task content). No
  `withSentryConfig` wrapper in the MVP (no source-map upload/tunneling —
  revisit post-beta).
- Fix forward if small; otherwise §3 rollback, then root-cause note
  (one paragraph: symptom, cause, fix, prevention) committed under
  `docs/operations/incidents/`.
- Comms: private beta → direct notice to affected users; no status page in MVP.

## 7. Open items before beta

Lock email provider + templates (M1), stand up the host monitor for VPS
`/api/health` (`scripts/vps-health-monitor.sh` on cron/systemd-timer),
rehearse §§4–5 once and file the evidence in issue 19.

## 8. Auth abuse controls (issue 05)

- Rate limits: per-IP fixed windows on register/login/verify/resend/
  forgot/reset (see `AUTH_RATE_LIMITS` in `lib/rate-limit/limiter.ts`) plus
  `account:delete` (5/hour) on the destructive account-purge endpoint.
  Budgets self-reset when the window passes; over-limit answers are 429 +
  `Retry-After`. A user seeing 429 on a shared network just waits out the
  window — no manual reset exists or is needed.
- The `rate_limit_hits` table self-prunes rows older than the largest window
  (1h) on every recorded hit; no worker, no cron.
- Sessions: expired rows are pruned lazily — on next login for that user and
  on Auth.js session reads. `APP_URL` must be the public origin in every
  environment or browser mutations 403 on the CSRF gate (E2E pins it to
  `http://127.0.0.1:3000` in `playwright.config.ts`). Before beta, trigger one staging error with canary task content
present and review the Sentry event to confirm no titles/notes/secrets
arrived (issue 06 manual gate).
