Status: open
Milestone: 1
Depends on: 01

## Scope

Prisma schema mirroring spec §10 + `sound_preset`/`sound_volume` (§10.2):
users, user_settings, tasks, timer_sessions (+ snapshots), focus_cycle_state.
Partial unique index (one active session per user), `(user_id, started_at)`
and `(user_id, status, position)` indexes, UTC stamps, duration/state checks
where practical. Neon wiring via `DATABASE_URL` (cloud or local container).

## Acceptance

- `prisma migrate deploy` from zero builds the full schema repeatably.
- DB rejects a second active session for the same user.

## Validation

- Integration: constraint tests (double-active rejected, indexes present),
  migration-from-zero in CI.

## Comments
