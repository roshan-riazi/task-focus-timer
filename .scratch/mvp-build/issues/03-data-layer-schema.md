Status: done
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

- 2026-09-08: implemented (TDD at agreed seams: schema-file, migration-SQL,
  client-wiring, live-DB constraints — 19/19 file tests green, 3 live-DB
  tests skip without DATABASE_URL and run in CI; `typecheck` + `lint`
  clean; full suite 62 passed / 3 skipped; PGlite (real Postgres
  semantics) verified migrate-from-zero repeatability, double-active
  (running + paused) rejection, completed-allowed, all CHECKs, indexes).
  Prisma 7.10: datasource URL lives in `prisma.config.ts` (schema `url`
  removed), partial unique via `raw()` predicate (`in` unsupported in
  object syntax), runtime via `@prisma/adapter-pg` in `lib/db.ts`
  singleton. CHECKs live in migration SQL (Prisma 7 cannot author
  CHECKs — same pattern as Prisma's own docs). Code-review (2 axes):
  fixed 2 state CHECKs (expected_end>started, completed/cancelled
  exclusive) + test-dedup; deferred with rationale: transactional
  session+cycle writes → issues 10/11, sound-preset allow-list →
  issue 13, email-normalization enforcement → issue 04, Auth.js
  tables → issue 04.
- Note: package.json/pnpm-lock prisma+pg deps co-committed with
  feat(02) (f83c681); this commit adds only the 03 sources. The 02
  baseline empty migration is replaced by the full init migration
  (02's `tests/ci-gates` still green).
