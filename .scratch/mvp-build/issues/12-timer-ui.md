Status: open
Milestone: 3
Depends on: 08, 10, 11

## Scope

Timer UI per prototype: progress ring (timestamp-derived, progressbar role),
controls, refresh restore + hidden-tab reconcile, expiry confirm dialog,
timer-state announcements (not per-tick). No audio (see 13).

## Acceptance

- Refresh/hidden-tab/expiry scenarios pass; reconcile display corrects
  within 1s of visibility.

## Validation

- E2E: restore, reconcile timing, dialog flows, reduced-motion. Keyboard-only
  run of all controls.

## Comments

- 2026-09-10: implemented on branch `12-timer-ui` (TDD at pre-agreed
  seams mirroring 08: timer API client with stubbed fetch, pure
  timestamp-derived time utils, TimerPanel via Testing Library against
  public roles with a stateful in-memory timer server, Playwright
  keyboard-only journeys with DB clock travel — 29 timer unit tests +
  7 e2e green; `typecheck` + `lint` clean; tasks journey 5/5 still green).
  Ships: `components/timer/` (api client with `Idempotency-Key` finalize,
  `time.ts` remaining/progress/format/expiry from server stamps,
  `TimerPanel` with SVG ring + progressbar role, start/pause/resume/
  complete-early/cancel/skip-break, idle interval picker defaulting to the
  server `next` proposal, mount restore + `visibilitychange` reconcile +
  local-expiry tripwire, Complete/Discard confirm dialog that replaces the
  controls while pending, state-change-only `role=status` announcements,
  `motion-reduce:transition-none` ring, focus-in/return + post-action focus
  retention), `Workspace` timer slot wiring, `e2e/timer-journey.spec.ts`
  (full keyboard loop incl. break skip, refresh restore, hidden-tab
  reconcile <1s, grace auto-reconcile, dialog Complete+Discard, emulated
  reduced-motion computed-style check, axe AA at 1280px + 320px with no
  320px overflow). No audio (stays in 13). Code-review (2 axes)
  dispositions: fixed — reconciled notice in the idle post-state (auto-start
  off), dialog-exclusive branch (no background transitions behind confirm),
  true-signature commit (background polls of unchanged state stay silent),
  manual-pick reset per cycle, race-free reconcile-timing assertion,
  `setSecondsRemaining` clock-travel naming; kept with rationale — picker
  itself (start requires `intervalType` per 10; defaults to `next` per §8.5),
  no post-action re-GET (finalize/current responses carry the announcement
  per 11's exactly-once contract; 409s still resync), no full document focus
  trap or Escape on the inline confirm (dismissal without a choice is
  invalid — the dialog persists until Complete/Discard). Flake notes: one
  pre-existing bcrypt timeout in `lib/auth/service.test.ts` under full-suite
  load (16/16 isolated, untouched by this diff, same as issue 08). Awaiting
  CI incl. webkit (chromium+firefox green locally); merge only when green.
