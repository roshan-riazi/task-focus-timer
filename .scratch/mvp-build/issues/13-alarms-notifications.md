Status: done
Milestone: 3
Depends on: 09, 12

## Scope

WebAudio-synthesized alarm presets (default `chime`) + in-settings preview +
volume, distinct focus-end vs break-end patterns, browser notifications on
finalize. Gesture-unlock handling; notification as the reliable hidden-tab
channel.

## Acceptance

- Correct preset at set volume on each moment; audible check passes; tasks
  and titles never touch notification/error payloads beyond first-party API.

## Validation

- Unit: preset→pattern mapping, volume validation. Manual M3 exit: audible
  check (tone, volume, distinctness). E2E: permission-denied path degrades
  to silent + visual.

## Comments

- 2026-09-10: implemented on branch `13-alarms-notifications` (TDD at
  pre-agreed seams mirroring 09/12: pure preset→pattern + volume unit,
  player over fake AudioContext, notify wrapper with stubbed Notification,
  settings client with stubbed fetch, preview + TimerPanel via Testing
  Library, Playwright denied-path journey — 34 new tests green;
  `typecheck` + `lint` clean; full unit suite 446 passed on hermetic run,
  502 passed + 1 pre-existing bcrypt flake (auth service, 16/16 isolated,
  same as issue 12) on live PG; timer E2E 7/7 + alarms E2E 1/1 green on
  chromium against user-space Postgres 17). Ships: `lib/alarms/`
  (presets reusing `SOUND_PRESETS`, volume helpers, WebAudio player with
  gesture unlock, silent never-throw), `lib/notifications/notify`
  (static-copy finalize notifications, denied→silent+visual, no task-data
  params by construction), `components/settings/api` (GET client for the
  sound slice, reused by issue 16), `components/alarms/alarm-preview`
  (keyboard preview button with silent status fallback),
  `TimerPanel` wiring (fresh sound settings per completed finalize,
  focus-end vs break-end moments, cancel/skip/discard silent, lazy read
  so mount keeps the single `GET current`). Code-review (2 axes)
  dispositions: fixed — preview catch (never-throw UI), denied
  early-return without re-prompt, fresh-per-finalize settings (no stale
  cache), shared `AlarmMoment` type; kept with rationale — permission
  prompting deferred to the issue-16 settings form (timer degrades
  gracefully), `toSettingsApiError`/`isValid+clamp` kept for client
  parity/future form use, per-field sanitize kept (Zod would reject the
  whole object where per-field fallback is wanted). Manual M3 exit
  remains: audible check (tone, volume, distinctness). Awaiting CI;
  merge only when green.
- 2026-09-10: done — merged via PR #26 (merge commit `a237b05`; all 8 CI
  gates green: typecheck, lint, audit, migrate, vitest, playwright,
  gitleaks, ci-required). Carry-over for issue 16: `components/settings/api`
  GET client + `AlarmPreviewButton` are ready to reuse in the settings
  form (preset preview + volume + timezone). Follow-up: permission-prompt
  UX lives with the issue-16 form (timer degrades gracefully until then).
  Manual M3 exit remains: audible check (tone, volume, distinctness).
