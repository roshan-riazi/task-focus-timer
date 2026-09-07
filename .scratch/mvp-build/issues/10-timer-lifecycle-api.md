Status: open
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
