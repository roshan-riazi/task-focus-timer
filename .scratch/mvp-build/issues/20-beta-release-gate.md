Status: in_review
Milestone: 5
Depends on: 10, 12, 14, 16, 17, 18, 19

## Scope

Beta gate: full registration-to-analytics journey, timer survives refresh +
inactivity, no multi-active or double-count under concurrency, no cross-user
leaks, DST-correct analytics, keyboard flows, desktop + mobile smoke on the
last two stable Chrome/Edge/Firefox/Safari, no excluded features required.

## Acceptance

- Definition of done (spec §15) checked line by line with evidence links.

## Validation

- Full CI + E2E matrix green; manual browser/device smoke log; perf smoke
  budgets met (3s view, p95 reads <500ms ex-cold-start, 1s reconcile).

## Comments

### Beta-gate verification (2026-09-20, actor opencode agent, branch `main` @ `1f3ce4c`)

Dependencies 10, 12, 14, 16, 17, 18, 19 all `done`. Issue 06 stays
`in_review` (manual Sentry canary-event review) — not in `Depends on:`,
carried below as an explicit owner gate.

Local re-verification this session (no code changes needed — gate only):

- `pnpm typecheck`: clean. `pnpm lint`: clean. `pnpm build`: clean
  (all routes listed, `/app*` dynamic).
- `pnpm test` (full vitest): 567 passed / 1 failed of 646 — the single
  failure is the known pre-existing bcrypt timing flake in
  `lib/auth/service.test.ts` ("resets the password…", 5s timeout under
  full-suite load; documented in issue 19). Passes in isolation: 19/19
  green on re-run. No new failures.
- Targeted seams re-run green: `lib/timer|analytics|sessions|tasks`
  services 100/100 (incl. analytics DST vectors).
- `pnpm audit`: 2 moderate, both ignored pre-existing vitest advisories.
  `prisma validate`: clean. (Typecheck/lint/build/audit mirror the CI
  gates, supporting the Validation claim below.)
- DB-backed integration + E2E cannot run in this env (no DATABASE_URL,
  peer-auth blocked) — CI is the source of truth for those (as in 17/19).

CI source of truth: run 91 (`1f3ce4c`, push to `main`) — **success**,
all 8 gates incl. Playwright Chromium+Firefox+WebKit and the build-only
docker gate:
https://github.com/roshan-riazi/task-focus-timer/actions/runs/35476086139

### DoD (spec §15) line by line

- All critical acceptance criteria pass — spec §13 gherkins mapped in
  `docs/testing/TEST_STRATEGY.md` §3; API + E2E suites green in CI run 91.
- Registration-to-analytics journey — `e2e/auth-journey.spec.ts`
  (register → use-before-verify → verify → login → reset, keyboard-only)
  + tasks/timer/history-analytics journeys; CI green. Sign-in lands on
  `/app` per spec §7.1 (issue 19 image-trial fix, unit + e2e pinned).
- Timer survives refresh + tab inactivity — `e2e/timer-journey.spec.ts`
  "refresh restores…" (reload → timestamp-derived remainder) and
  "hidden-tab return reconciles…within one second" (`<1000ms` assertion);
  server-authoritative timestamps (issues 10/11/12).
- Expired timers reconcile after close — issue 11: 60-min auto/confirm
  paths, server-owned `reconcile:<id>` key, clock-travel API + e2e expiry
  dialog (Complete bounded / Discard cancelled), exactly-once.
- No multi-active under concurrency — partial unique index + `409
  ACTIVE_TIMER_EXISTS` incl. concurrent double-start
  (`app/api/timer/timer.integration.test.ts`); still one active row.
- No double-count on duplicate completion — `Idempotency-Key` unique
  `(user,key)` + tx-conditional flip; concurrent same-key completes
  finalize once with max one cycle bump; different-key replay →
  `409 ALREADY_FINALIZED`.
- No cross-user leaks — session-derived identity everywhere (no
  client user IDs); cross-user integration tests both directions
  (tasks/sessions/timer/analytics); byte-identical 404 bodies for
  foreign vs missing ids (issue 18); canary-scrub pins (no task content
  in logs/errors/payloads outside first-party bodies).
- DST-correct analytics — `lib/analytics/service.test.ts`: calendar
  subtraction (never N×24h), Europe/Berlin spring-forward + fall-back
  Sundays, UTC±12 date-line; UTC stamps untouched. Re-run green today.
- Keyboard flows — keyboard-only e2e (auth, tasks, timer, deletion via
  Tab/type/Enter, `tabTo` helpers); issue 17 audit fixed + re-verified
  (skip link, dialog trap, focus return/recovery, field errors, 320px
  DOM order); axe WCAG 2.1 AA clean.
- Desktop + mobile smoke — Playwright Chromium/Firefox/WebKit ×
  1280px + 320px viewports (no-overflow assertions); `scripts/vps-smoke.sh`
  (login, 1-min focus, history/analytics, health 200) PASS in the issue
  19 image-trial. Mapping: Chromium covers Chrome/Edge engines, WebKit
  covers Safari engine. Real-device manual log on last-two-stable
  Edge/Safari versions → owner carry-over below.
- HTTPS/secrets/backups/monitoring/rate-limit — `__Secure-` + Secure
  cookies on HTTPS APP_URL (CSRF origin gate); env-file secrets,
  fail-closed entrypoint; pg_dump 30-day expiry + isolated-restore drill
  PASS (issue 19); Sentry wired on all runtimes (`beforeSend` scrub,
  `sendDefaultPii: false`) + `/api/health` + host monitor; 6 auth
  buckets + `account:delete` 5/hour with live-429 pins. Sentry
  canary-event manual review → issue 06 owner carry-over.
- Account deletion + privacy disclosures — `DELETE /api/account`
  (session identity, CSRF + rate gate, cascade purge, P2025-tolerant) +
  settings danger zone + public `/privacy` (live purge immediate,
  backups ≤30d) linked from footer + register; deletion drill PASS
  (issue 18: 9-table purge, relogin 401, email re-register 201).
- No excluded features required — full spec §5.2 sweep (teams/orgs,
  shared tasks, manager dashboards, monitoring/surveillance, public
  profiles, social/leaderboards, projects/subtasks/kanban/gantt, calendar
  + third-party integrations, billing, native apps, offline sync, AI/
  predictive/tracking, history editing, WebSockets, custom dashboards,
  client telemetry): no implementations in `app/ lib/ components/`.
  Only benign word-hits: local calendar-day math (required reporting),
  route "segments", "native" buttons/SVG/toolchain notes, and explicit
  no-telemetry statements in `/privacy` + RUNBOOK.

### Validation

- Full CI + E2E matrix green — see run 91 link above (all 8 gates).
- Perf smoke budgets (TEST_STRATEGY §4, smoke — not load testing):
  analytics `<2s` on 400-session fixture (e2e perf smoke, chromium,
  covers an API read + page render); reconcile `<1s` (e2e hidden-tab
  assertion). Directly unmeasured: 3s primary-view usability and p95
  reads `<500ms` — no timing harness exists; covered only indirectly
  (lightweight personal-scale queries, no N+1 shapes). Owner decides
  whether to accept smoke-level evidence or require a harness.
- Manual smoke log: automated matrix + vps-smoke + image-trial +
  browser-trial recorded in issue 19 comments; deletion drill in 18.

### Owner carry-overs before beta (why `in_review`, not `done`)

1. Real-device manual passes on the last two stable Edge/Safari
   (+ a mobile Safari/Chrome spot-check) with a dated smoke log.
2. Issue 06 manual gate: trigger one staging error with canary task
   content present, review the Sentry event, file the result in 06.
