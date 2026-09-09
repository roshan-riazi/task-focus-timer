# FocusFlow — Runbook

Status: accepted (2026-09-07; owner approved)

Targets: Vercel + Neon (primary) · own VPS via Docker · local Debian 13.
No workers, no cron vendor lock-in. No product-analytics telemetry anywhere.

## 1. Environment matrix

| Item | Vercel prod | VPS | Local Debian |
| --- | --- | --- | --- |
| App | Vercel project, `main` auto-deploy | `standalone` Docker image, pinned tag | `pnpm dev` or same image via compose |
| DB | Neon cloud (`DATABASE_URL`) | Neon cloud **or** container Postgres | Container Postgres |
| Migrations | CI `prisma migrate deploy` pre-deploy | Container entrypoint `migrate deploy` | `prisma migrate dev` |
| Secrets | Vercel env dashboard | Host env file, never in repo | `.env.local`, never committed |
| Health | `GET /api/health` + Vercel checks | `GET /api/health` + host monitor | `GET /api/health` |

Required env: `DATABASE_URL`, `AUTH_SECRET`, email provider keys, error
monitoring DSN. meat: every target gets all four or it does not boot (fail
closed, no defaults for secrets).

## 2. Deploy

- Vercel: merge to `main` → CI gates (typecheck, lint, audit, migrate test DB,
  Vitest, Playwright, Gitleaks) → `prisma migrate deploy` → Vercel build →
  smoke: login, start/pause/complete a 1-minute focus, history + analytics
  render, `/api/health` 200.
- VPS: build + tag image (`git sha`), push registry, pull on host,
  `docker compose up -d`, entrypoint migrates, same smoke script.
- Local: `pnpm install`, `docker compose up -d db`, `prisma migrate dev`,
  `pnpm dev`.

## 3. Rollback

- Vercel: instant rollback to previous deployment in dashboard; migrations are
  forward-only, so a rollback past a migration needs a compensating migration —
  never `migrate reset` against shared data.
- VPS: re-tag previous image and re-run compose; same migration caution.
- Rule: schema changes must be backward-compatible for one release (expand,
  backfill, then contract) so any rollback stays readable.

## 4. Backup & restore drill

- Neon automated backups are the primary (verify retention covers the
  published 30-day expiry story before beta). VPS path additionally keeps
  scheduled `pg_dump` artifacts with the same 30-day expiry.
- Neon history-window caps (re-confirm in Console → Settings → Instant
  restore before beta): Free 6h (1 GB cap), Launch ≤7d, Scale ≤30d. The
  published 30-day backup-expiry copy requires the Scale plan at a 30-day
  window, or `pg_dump`-to-remote artifacts with 30-day retention —
  Free/Launch point-in-time history alone does NOT cover it (issue 06).
- Drill (pre-beta, then quarterly): restore into an isolated database, run
  migration check + history/analytics spot queries, record evidence
  (date, actor, result). Never restore over live data as a test.

## 5. Deletion evidence (account + task)

- Account: confirm → verify live rows gone (user, settings, tasks, sessions,
  cycle state) via count queries on a read replica/transaction; record
  timestamp + actor. Backups age out in 30 days — state this in the privacy
  copy; do not purge backup media early.
- Task: verify row gone and session snapshots (`task_title_snapshot`,
  `category_snapshot`) intact.

## 6. Incident basics (solo)

- Triage order: `/api/health` → recent deploy diff → DB reachability → error
  monitor (scrubbed, no task content) → request-ID logs.
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

Lock email provider + templates (M1), confirm Neon retention vs 30-day copy,
stand up the host monitor for VPS `/api/health`, rehearse §§4–5 once and file
the evidence.

## 8. Auth abuse controls (issue 05)

- Rate limits: per-IP fixed windows on register/login/verify/resend/
  forgot/reset (see `AUTH_RATE_LIMITS` in `lib/rate-limit/limiter.ts`).
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
