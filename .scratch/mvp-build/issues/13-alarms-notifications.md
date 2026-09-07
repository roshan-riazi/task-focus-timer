Status: open
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
