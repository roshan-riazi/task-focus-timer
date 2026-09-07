# ADR-0002: Data, auth, and deployment foundation

Status: accepted (2026-09-07)

## Context

Same constraints as ADR-0001, plus: managed auth preferred; verification
non-blocking; immediate live purge on account delete with 30-day backup expiry;
completed tasks retained until delete; per-user scoping everywhere; at most one
running/paused timer per user; UTC storage with IANA-timezone reporting;
transactional session + focus-cycle updates. See [Choose data, auth, deployment
foundation](../.scratch/focusflow-mvp/issues/07-choose-data-auth-deployment-foundation.md).

## Decision

- Database: Neon Postgres (free-tier, branching), accessed via Prisma with
  repeatable migrations (`prisma migrate deploy`).
- Constraints in Postgres: partial unique index for single active
  (`running`/`paused`) session per user; indexes on `(user_id, started_at)` and
  `(user_id, status, position)`; all timestamps UTC.
- Auth: Auth.js v5 with database sessions (single-DB purge story; non-blocking
  verification; password-reset flow). Transactional email via env-pluggable
  provider (Resend suggested, not locked).
- Deployment: Vercel primary **plus** portable Docker (`output: standalone`,
  Node 22, `next start`) for own VPS and local Debian 13. Postgres via
  `DATABASE_URL` (Neon cloud or local container). No vendor cron, no Edge-only
  timer logic.
- Expiry handling: lazy reconcile-on-next-interaction per spec §8.4 (no
  background workers); 60-minute confirm threshold with Complete/Discard.

## Consequences

- Positive: one database holds the whole purge story; Prisma adapters and
  migration story are agent-friendly; same artifact runs on Vercel, VPS, and
  local; no worker ops at <1k users.
- Negative: Auth.js email wiring is ours (provider + templates); Neon free-tier
  backup limits must be checked against the published 30-day policy; DB-backed
  sessions need the cleanup story documented in the runbook.
- Follow-up: lock the email provider + templates during Milestone 1 auth work.
