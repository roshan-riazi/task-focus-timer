Status: in progress
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

- 2026-09-09: implemented on branch `07-task-api` (TDD at agreed seams:
  validation-Zod, service-over-ports, HTTP handlers hermetic, live-DB
  integration — 51 task tests green; full suite 272 passed; `typecheck` +
  `lint` clean). Routes: `GET/POST /api/tasks`, `GET/PATCH/DELETE
  /api/tasks/:id`, `POST :id/complete`, `POST :id/reopen`, `POST
  /api/tasks/reorder` (static segment wins over `[id]`). Contract:
  soft-delete + snapshot backfill in one tx, full-active-set reorder as
  `(index+1)*1000`, opaque base64url cursor over `(position, id)`,
  `TASK_LOCKED_BY_TIMER` 409 on every mutation of the timer-linked task,
  leak-free 404s, CSRF gate on mutations (no rate-limit bucket:
  cookie-authed writes, not anonymous abuse targets). Code-review
  (2 axes): fixed unscoped store writes (`updateMany` + `userId`
  predicate + count) and tightened the archive lifecycle (only active
  tasks archive; archived tasks complete/reopen only after unarchive —
  no stranded completion stamps). Deferred with rationale: `GET :id`
  (acceptance "requests the other user's task" needs a read path),
  `archived|all` filters + active pagination (uniform seam superset),
  `fields` map on 400s (repo auth pattern), full-order-only reorder +
  no midpoint inserts (round-trip acceptance; 1000-steps never skew at
  personal scale), handler/auth seam duplication (distinct error types;
  shared envelope via guards), `TaskSessionRow` export (fake-store
  vocabulary in service.test.ts). Awaiting CI (merge only when green).
