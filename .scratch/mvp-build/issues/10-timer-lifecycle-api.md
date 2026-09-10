Status: done
Milestone: 3
Depends on: 03, 04, 05, 09

## Scope

Timer REST API per spec §11.2 + SYSTEM_DESIGN §4/§6: start/pause/resume/
complete/cancel/skip-break. Planned durations read from saved settings at
start; client never authors elapsed time. Server-computed durations, atomic
transitions, `409` codes (`ACTIVE_TIMER_EXISTS`, `NO_ACTIVE_TIMER`,
`ALREADY_FINALIZED`), `Idempotency-Key` finalization. No UI.

## Acceptance

- One active row max enforced at DB + API. Double-complete (same key,
  concurrent) finalizes once. Pause travel excludes gap from actual duration.

## Validation

- API: transitions, conflicts, idempotent concurrency test, pause math with
  injected clock. Unit: pause/cycle math.

## Comments

- 2026-09-10: implemented on branch `10-timer-lifecycle-api` (TDD at
  pre-agreed seams mirroring 07/09: validation-Zod, service-over-ports,
  HTTP handlers hermetic, live-DB integration — 60 timer tests green;
  full suite 408 passed on live PG; `typecheck` + `lint` clean; `migrate
  deploy` verified from zero incl. the new idempotency table). Routes:
  `GET /api/timer/current`, `POST /api/timer/{start,pause,resume,
  complete,cancel,skip-break}`, `{ session }` / `{ session: null }`
  envelopes, CSRF gate on mutations only, no rate-limit bucket
  (cookie-authed writes, issue 05 scope). Contract: start body is
  `intervalType` + optional `taskId` only (planned seconds read from
  `user_settings` at start, elapsed always server-computed); `409`s
  `ACTIVE_TIMER_EXISTS` (second start incl. concurrent, via partial
  unique index), `NO_ACTIVE_TIMER` (pause/resume/finalize with no
  history), `ALREADY_FINALIZED` (repeat finalize under a different or
  missing key), `INVALID_TRANSITION` (double-pause, resume-while-running,
  skip-focus); `Idempotency-Key` 1–128 chars optional on
  complete/cancel/skip-break, same-key replay returns the original row
  with no second cycle bump (unique `(user_id, key)` + conditional
  status flip in one `$transaction`, 24h lazy TTL). Cycle: full-expiry
  focus complete increments once, early complete doesn't, long-break
  complete/skip resets, cancel never touches. Pause math: gap shifts
  `expected_end_at` forward whole seconds; paused finalize measures to
  `paused_at`; actual bounded to `[0, planned]`. Snapshots written at
  finalize (null-resilient). Code-review (2 axes): fixed
  `isFullExpiry` dead-field signature, `TaskSnapshot.status` typed as
  `TaskStatus`, `replay`/`full` renames; kept with rationale: service
  computes `actual` from a pre-tx snapshot (worst case ms skew under a
  pause/finalize race, plan-bounded — finalize hardening belongs to
  issue 11's reconcile work). Reconcile (60-min auto/confirm), break
  proposal, and auto-start stay in issue 11 — no scope taken. Awaiting
  CI (merge only when green).
- 2026-09-10: done — merged via PR #20 (merge commit `29370c5`; all 8 CI
  gates green: typecheck, lint, audit, migrate, vitest, playwright,
  gitleaks, ci-required). Carry-over for issue 11: lazy expiry
  reconcile (auto <60 min, Complete/Discard confirm beyond), break
  proposal + auto-start creation, and finalize-path hardening (recompute
  `actual` inside the finalize transaction — currently pre-tx snapshot,
  ms-skew bounded by the plan cap).
