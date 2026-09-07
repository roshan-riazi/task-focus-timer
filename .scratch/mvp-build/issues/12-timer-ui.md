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
