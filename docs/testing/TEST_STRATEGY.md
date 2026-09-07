# FocusFlow — Test Strategy

Status: accepted (2026-09-07; owner approved)

Backbone (locked): Vitest (unit/integration) + Playwright (e2e) + Testing
Library. CI: GitHub Actions (typecheck, lint, audit, migrate, all suites,
Gitleaks). No product-analytics telemetry — including negative assertions.

## 1. Test levels

- Unit (Vitest): pure logic — pause math, cycle transitions, window grouping
  (timezone/DST vectors), Zod schemas, error-envelope builders, cursor
  encode/decode, scrubbing helpers.
- Integration / API (Vitest + test Postgres): REST routes with real DB —
  auth scoping, task CRUD/position, timer transitions + 409s, idempotent
  finalize (same `Idempotency-Key` twice → one row, one cycle bump),
  transactional session+cycle writes, cursor pagination, analytics aggregates,
  rate-limit behavior, `/api/health`.
- E2E (Playwright, Chromium + Firefox + WebKit): first-use journey,
  task↔timer loop, refresh restore, hidden-tab reconcile, expiry confirm
  dialog, keyboard-only runs, 320px + desktop viewports, reduced-motion,
  empty states, settings cutover, deletion flow.
- Accessibility (Playwright + axe): WCAG 2.1 AA checks on workspace, dialogs,
  tables-as-chart-equivalents; manual screen-reader pass reserved for M5.
- Security/privacy (mixed): cross-user isolation tests at API level; canary
  fixtures (e.g. `CANARY_TASK_TITLE`) asserted absent from logs, error
  reports, and all network payloads except first-party API bodies; no client
  telemetry calls exist to fire.

## 2. Determinism rules

- Server clock is injectable: timer math takes `now` as a parameter; tests
  freeze/travel it (no real 25-minute waits; no 5-minute real pauses — the
  "paused 5 minutes" criterion is proven by traveling the clock and asserting
  remaining time and actual duration exclude the gap).
- Test Postgres per run (`prisma migrate deploy` + per-test users); timezones
  pinned per case (`Europe/Berlin` for DST vectors incl. a spring-forward and
  a fall-back Sunday; one UTC±12 case for date-line sanity).
- Playwright timer tests use short durations via settings (1-minute focus)
  plus clock travel for expiry paths — never wall-clock 25/60 minutes.

## 3. Acceptance-criteria map (spec §13 + locked clarifications)

Tasks:

- Create → appears → survives logout/login: e2e (+ API).
- Delete with sessions → gone from active, snapshots kept: API + e2e.
- Cross-user fetch → forbidden/not-found, no leak: API (both directions).

Timer:

- Start on selected task → exactly one linked row with planned/end stamps: API.
- Refresh mid-run → same interval, timestamp-derived remainder: e2e + API.
- Pause + 5 min travel → remainder unchanged, duration excludes gap: API (math)
  + e2e (display).
- Second start while active → `409 ACTIVE_TIMER_EXISTS`, still one row: API.
- Expiry while closed, back <60 min → auto-completed exactly once in history +
  analytics: API (travel) + e2e (one row renders once).
- Expiry while closed, back >60 min → confirm dialog; Complete → bounded
  minutes / Discard → cancelled, no minutes, no cycle: e2e + API.
- Double-complete (same key, concurrent) → finalized once, cycle +1 max: API
  concurrency test.
- Alarm mapping: preset key + volume persist via settings API; unit tests assert
  each preset maps to its focus/break tone pattern and out-of-range volume is
  rejected by validation. Audible check (correct tone, volume honored) is a
  manual M3 exit item, not automated.
- Complete-early → completed minutes counted, cycle NOT incremented: API.
- Breaks persisted + filterable; settings apply to new intervals only: API + e2e.

Analytics:

- 25-min completion → minutes +25, count +1: API.
- Cancel → denominator only, zero minutes: API.
- Non-UTC timezone → local-day grouping: API vectors.
- DST transition → grouping correct, UTC stamps untouched: API vectors.
- Rolling Today/7d definitions; empty-state copy: API + e2e.
- Table equivalents for every chart: e2e + axe.

Milestone exits:

- M1: CI green, Auth.js flows in test env, repeatable migrations from zero,
  cross-user tests present — CI gate.
- M5: a11y audit, desktop+mobile smoke, HTTPS/secrets/backups/monitoring,
  deletion-evidence, privacy disclosures — checklist with automated parts
  above + manual passes recorded.

## 4. NFR probes (lightweight, honest scope)

- Perf smoke (not load testing): seeded personal-scale fixture; assert primary
  view interactive <3s on broadband-class throttling and analytics <2s; API
  reads p95 <500ms excluding cold starts, measured in CI as a smoke budget.
- Reconcile-on-visible: hidden-tab travel → display corrects within 1s: e2e.
- Deletion: confirm → live rows gone; backup-expiry is a runbook drill, not an
  automated prod-restore test.
- Browser matrix: Playwright projects for latest Chromium/Firefox/WebKit at
  320px, 768px, 1280px.

## 5. CI gates (all required to merge)

`pnpm typecheck` → `lint` → `audit` → `migrate deploy (test DB)` →
`vitest run` → `playwright test` → `gitleaks`. Fail-closed on missing
timezone vectors or absent canary-scrub assertions.
