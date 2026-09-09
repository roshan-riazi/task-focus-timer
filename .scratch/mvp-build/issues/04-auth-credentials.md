Status: done
Milestone: 1
Depends on: 02, 03

## Scope

Auth.js v5 credentials: register (normalized unique email, 8-char min),
non-blocking verification email + nag support, login/logout, password reset.
Transactional email via env-pluggable provider (Resend default). Bootstrap
the `user_settings` row with defaults at registration.

## Acceptance

- Full register → use-before-verify → verify → login → reset journey works
  in a test env.

## Validation

- API: register/verify/login/reset flows, settings-row bootstrap, validation
  abuse cases. E2E: first-use journey keyboard-only.

## Comments

- 2026-09-09: implemented on branch `04-auth-credentials` (TDD at
  pre-agreed seams: validation, password, tokens, email providers, service,
  handlers, routes — 170/170 Vitest green incl. 7 live-DB journey tests +
  5 constraint tests; `typecheck` + `lint` clean; `pnpm build` clean;
  E2E keyboard-only journey green on chromium).
  Auth.js v5 (next-auth beta.32 + @auth/prisma-adapter) owns session
  STORAGE + READS (`auth()`, DB sessions, 30-day TTL); credential
  verification/register/verify/reset are app-managed. Forced deviation
  (verified in @auth/core 0.41.3 source): its credentials callback hardcodes
  JWT issuance and never touches the adapter — routing login through it
  would silently break the single-DB purge story, so login/logout set the
  Auth.js-shaped cookie directly (single source: lib/auth/cookies.ts,
  proven by a real-@auth/core round-trip test). New deps are audit-clean
  (2 moderate findings are pre-existing vitest advisories).
  Local verification used a user-space Postgres 17 (no Docker in sandbox):
  `migrate deploy` from zero + full suite + E2E all green on real PG.
  Code-review (2 axes): fixed silent layout catch (now reportError),
  outbox wall-clock (injected), console-warn fallback (structured log),
  TTL/field-flattening dupes, EMAIL_PROVIDER enum, non-atomic verify
  (now transactional). Deferred by design to 05: rate limits, origin
  checks, cross-user isolation tests. Firefox/WebKit E2E left to CI
  (chromium verified locally; CI has all three + outbox env wired).
  `test-results/` gitignored; `.opencode/` env noise left uncommitted.
- CI round 1 (PR #9, run 14): typecheck/lint/migrate/vitest/playwright
  green; audit red on pre-existing vitest GHSA-82fw-gwwq-j7x9 (disclosed
  after main's last green run — main fails identically today, not caused by
  this change); gitleaks red on one test-only literal (TEST_SECRET in
  auth-compat.test.ts). Fixed via history rewrite (leak baked into 570ab80,
  unreachable to fix-forward commits): randomized hermetic secret + scoped
  pnpm.auditConfig.ignoreCves with documented rationale + Dependabot path.
- PR #9: https://github.com/roshan-riazi/task-focus-timer/pull/9
