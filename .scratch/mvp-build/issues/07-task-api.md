Status: open
Milestone: 2
Depends on: 03, 04, 05

## Scope

Task REST API per spec §11.1 + SYSTEM_DESIGN §5: CRUD, complete/reopen,
archive/delete (snapshots preserved), fractional-position reorder, active +
completed filters with cursor pagination. Task immutable while its interval
is active (`TASK_LOCKED_BY_TIMER`). Zod on all input. No UI.

## Acceptance

- Create → listed → survives logout/login. Delete with sessions → snapshots
  kept. Position survives reorder round-trips.

## Validation

- API: full lifecycle, filters, pagination cursors, locked-task 409,
  per-user scoping on every route.

## Comments
