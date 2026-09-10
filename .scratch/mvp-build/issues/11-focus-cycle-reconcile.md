Status: done
Milestone: 3
Depends on: 10

## Scope

Cycle + reconcile rules in one transaction: full-expiry increments cycle,
complete-early doesn't; long-break propose/reset/skip; lazy expiry reconcile
(auto <60 min, Complete/Discard confirm beyond); settings cutover to new
intervals only. No UI.

## Acceptance

- All §8.5 rules + 60-minute confirm paths behave per spec; no duplicate
  history/analytics rows on any reconcile path.

## Validation

- API with clock travel: expiry auto vs confirm, Discard semantics,
  cycle increments exactly once. E2E: confirm dialog both choices (needs 13).

## Comments

- 2026-09-10: implemented on branch `11-focus-cycle-reconcile` (TDD at
  pre-agreed seams mirroring 10: service-over-ports hermetic fake,
  HTTP handlers hermetic, live-DB integration; validation seam untouched —
  no new client input). No schema migration (cycle state + idempotency
  tables already cover the writes).
- Contract (additive, `{ session }` keys intact): `GET /api/timer/current`
  is the reconcile entry point → `{ session, reconciled, pending-
  Confirmation: { session, overdueSeconds } | null, autoStarted, cycle:
  { completedFocusCount, intervalsBeforeLongBreak }, next }`. Within
  60 min past `expected_end_at` it auto-finalizes as completed exactly
  once (server-owned `reconcile:<id>` key, concurrent losers replay the
  winner; repeat reads report plain post-state — exactly-once
  announcement); beyond 60 min it finalizes nothing and the client
  confirms via explicit complete (= Complete, bounded minutes + cycle)
  / cancel (= Discard, no minutes/cycle/auto-start). Paused intervals
  never expire. `POST complete/cancel/skip-break` → `{ session,
  autoStarted, cycle, next }`; `autoStarted` is non-null only when the
  call created it (replays report null). Break proposal shared via
  `proposalForInterval` (service envelope + store tx); auto-start fires
  in the finalize tx on complete/skip only, never on cancel.
- Hardening (issue 10 carry-over): `tryFinalize` takes `mode` + `at` and
  computes actual/cycle/proposal/auto-start from the row as read inside
  the tx — stale-snapshot race pinned by a spoofed-read unit test.
- Validation: 46 service tests (proposal math, grace boundary incl.
  ms-precision, auto vs confirm, Discard, paused-frozen, idle proposal,
  auto-start gating, cutover, deterministic overlap replay), 21 live-PG
  integration tests (clock-travel auto/confirm/Discard, concurrent
  currents → one row + one bump, 4-focus long-break proposal + reset,
  auto-start, cutover, paused). Full suite 440 passed on live PG;
  `typecheck` + `lint` + `pnpm build` clean; chromium+firefox e2e pass
  (webkit binary missing locally — environmental, CI covers it).
  Code-review (2 axes): fixed loser double-announce of auto-start, ms
  grace verdict, shared proposal helper; kept with rationale: reconcile
  on `current` only (mutations on expired rows already yield the
  specified outcomes; client reconciles first per §8.4), fake/store
  tryFinalize parity by design. E2E confirm-dialog both choices stays
  with UI work (needs 12/13) — no UI in this issue. Awaiting CI (merge
  only when green).
