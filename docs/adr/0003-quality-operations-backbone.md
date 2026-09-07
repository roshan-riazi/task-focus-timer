# ADR-0003: Quality and operations backbone

Status: accepted (2026-09-07)

## Context

Must verify Milestone 1 exit (CI green, auth works in test, repeatable
migrations, cross-user auth tests) and Milestone 5 release-readiness (a11y
audit, security review, monitoring, deletion flow) on free-tier, solo-operated
infra — with **no anonymous product analytics** (locked constraint; spec §12.5
updated to DB-derived aggregates only) and publish-ready secret hygiene for a
currently-private, maybe-public repo. See [Choose quality and operations
backbone](../.scratch/focusflow-mvp/issues/08-choose-quality-operations-backbone.md).

## Decision

- Testing: Vitest (unit/integration, incl. API routes against a test DB) +
  Playwright (e2e: timer lifecycle, refresh restore, expiry reconcile,
  keyboard-only, mobile layouts) + Testing Library.
- Observability: structured logs with request IDs (no task titles/notes) +
  scrubbed error monitoring (Sentry free-tier suggested); no client product
  events.
- CI: GitHub Actions (typecheck, lint, test, migrate) + Dependabot + package
  audit + Gitleaks secret scanning.
- Resilience: DB-backed rate limiting on auth/sensitive mutations (portable;
  Redis later if needed); secure HTTP-only SameSite cookies with origin checks
  on mutations; Neon automated backups underpinning the 30-day expiry story;
  `/api/health` (no user data); `prisma migrate deploy` in CI and container
  entrypoint.

## Consequences

- Positive: real-browser coverage of the riskiest timer paths; no analytics
  SDK to scrub or disclose; portable rate limiting with zero extra infra;
  publish-safe hygiene from day one.
- Negative: DB-backed rate limiting adds a write per guarded attempt (fine at
  this scale); Sentry needs a scrubbing allow-list and DSR story despite no
  task content; Playwright matrix (desktop + mobile viewports) costs CI minutes.
- Follow-up: TEST_STRATEGY must map each acceptance criterion to its suite;
  RUNBOOK must document backup/restore verification and deletion-evidence steps.
