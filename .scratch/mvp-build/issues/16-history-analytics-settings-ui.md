Status: done
Milestone: 4
Depends on: 14, 15

## Scope

History + analytics + settings pages per prototype: tables, native-SVG daily
bars with full table equivalents, ranked lists, metric cards, explanatory
empty states, settings form (incl. preset preview + volume + timezone).
Keyboard + 360px-to-desktop + reduced-motion + axe clean.

## Acceptance

- Every chart has a text/table equivalent; empty states guide action; no
  information by color alone; settings edits apply to new intervals only.

## Validation

- E2E + axe on all three views incl. empty states and deleted-task rows.
  Perf smoke: analytics <2s on seeded personal-scale fixture.

## Comments

- 2026-09-10: implemented and merged to `main` via PR #30 (TDD at agreed
  seams mirroring 07/10/14/15: typed fetch-wrapper clients, panels over
  stubbed fetch, keyboard-only E2E — 35 unit tests green; full suite 603
  green modulo the known unrelated bcrypt flake; `typecheck` + `lint`
  clean; CI fully green on retrigger incl. playwright on all browsers).
  Pages: `/app/history` (Today/7d/30d + All/Focus-only filters,
  Type/Task/Started/Ended/Actual/Status table, cursor pagination,
  snapshot-legible deleted-task rows), `/app/analytics` (metric cards,
  native-SVG daily bars with table equivalents, ranked by-task/by-category
  lists, Today/7d), `/app/settings` (minute inputs converted to seconds at
  the PATCH boundary, preset preview + volume + timezone, field errors,
  new-intervals-only notice); shell nav extended, header wraps at 320px.
  Contract notes: "Completed early" is client-inferred from
  actual<planned (no server disposition — prototype row, same basis as
  issue 14's plannedDurationSeconds rationale); empty-analytics signal is
  the null rate per issue 15 (cancelled-only shows 0% + ranked-list
  guidance, not the banner); settings form re-syncs the full saved row.
  Code-review (2 axes): fixed End-time column (spec §8.8), category empty
  state, period-aware empty copy, settings re-sync; kept with rationale:
  no /app/tasks nav (issue 08 scope), no shared client wrapper (per-client
  error types are the branching seam — revisit at 6th client), relative
  date-line-safe E2E seeding. Validation: 9-test E2E journey green on
  Chromium/Firefox/WebKit (filters, deleted-task rows, cutover,
  signed-out, 320px, reduced-motion, axe on all views incl. empty states,
  analytics <2s on 400-session fixture); existing tasks/timer mobile+axe
  re-checked, no regressions.
