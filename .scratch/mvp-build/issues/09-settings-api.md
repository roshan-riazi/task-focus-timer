Status: in progress
Milestone: 3
Depends on: 03, 04, 05

## Scope

Settings REST API: `GET/PATCH /api/settings` incl. durations, cycle count,
auto-start flags, sound on/off + preset + volume (preset key allow-list,
0–100 range), notifications flag, IANA timezone. Zod on all input.

## Acceptance

- Invalid preset/volume/timezone rejected; valid patch persists and is
  returned on GET; scoped per user.

## Validation

- API: validation matrix, scoping, defaults bootstrap (from 04).

## Comments

- 2026-09-10: implemented on branch `09-settings-api` (TDD at pre-agreed
  seams mirroring 07: validation-Zod, service-over-ports, HTTP handlers
  hermetic, live-DB integration — 36 settings tests green; full suite 348
  passed on live PG; `typecheck` + `lint` + `pnpm build` clean; `migrate
  deploy` verified from zero on user-space Postgres 17). Routes:
  `GET/PATCH /api/settings`, `{ settings }` envelope, CSRF gate on PATCH
  only, no rate-limit bucket (cookie-authed writes, issue 05 scope).
  Contract: seconds units (storage units, no conversion), camelCase keys;
  ranges focus 60–7200 / breaks 60–3600 / cycle 1–10 / volume 0–100 int;
  preset allow-list `chime|bell|pulse|gong` (prototype select + ticket 10,
  exported as `SOUND_PRESETS` for issue 13 reuse); timezone IANA via
  Intl check in parity with register; `users.timezone` + `user_settings`
  written in one tx; GET bootstraps defaults idempotently (upsert,
  race-safe) for pre-04 rows. Code-review (2 axes): fixed dead
  `findSettings` (GET now finds-first so steady-state reads stay reads)
  + moved empty-patch refine into the schema (task-route parity). Kept
  with rationale: non-strict strip of unknown keys incl. forged `userId`
  (repo-wide Zod default, same as tasks — identity stays session-derived);
  empty-PATCH 400 (task-route parity, not scope creep); timezone
  canonicalization deferred — Intl accepts case-variants/abbreviations
  (e.g. `EST` → `America/Panama`) and registration (04) stores them
  verbatim today, so tightening settings alone would fork the two
  validators; coherent fix touches auth + settings together (follow-up).
  DB-level preset/range CHECKs left to follow-ups per 03's deferral note
  (allow-list enforced at the Zod boundary here). Awaiting CI (merge only
  when green).
