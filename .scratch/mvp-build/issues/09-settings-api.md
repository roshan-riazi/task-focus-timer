Status: open
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
