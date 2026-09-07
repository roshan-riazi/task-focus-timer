Status: open
Milestone: 5
Depends on: 02, 06

## Scope

Ship to all three targets: Vercel + Neon EU co-location, VPS Docker image,
local compose. Runbook §§2–5 rehearsed: deploy, forward-only rollback,
backup/restore drill into an isolated DB, deletion evidence. Host monitor on
VPS `/api/health`.

## Acceptance

- Same artifact green on all three targets; drill evidence recorded; rollback
  path proven without touching live data.

## Validation

- Smoke script (login, 1-min focus, history/analytics render, health 200) on
  each target. Drill record filed in issue comments.

## Comments
