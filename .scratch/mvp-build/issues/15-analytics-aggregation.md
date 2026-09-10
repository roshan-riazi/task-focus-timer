Status: done
Milestone: 4
Depends on: 14

## Scope

Timezone-aware aggregation per spec §8.9 + locked periods (Today = local day,
7d = rolling 7 local days incl. today): minutes, counts, completion rate,
daily bars, by-task/by-category, averages — computed from source rows.
`GET /api/analytics/summary?period=today|7d`. No UI.

## Acceptance

- 25-min completion → +25 min/+1; cancel → denominator only; non-UTC grouping
  correct; DST transitions correct with UTC stamps untouched.

## Validation

- API vectors: Europe/Berlin spring-forward + fall-back Sundays, one UTC±12
  case, empty-state aggregates. Unit: grouping helpers.

## Comments

- 2026-09-10: implemented on `main` (TDD at agreed seams mirroring 07/10/14:
  validation-Zod, service-over-ports, HTTP handlers hermetic, live-DB
  integration — 34 analytics tests green: 4 validation + 16 service + 5
  handlers + 9 integration; `typecheck` + `lint` clean). Route:
  `GET /api/analytics/summary` (`period=today|7d` default `7d`, unknown
  keys strip per repo Zod default), `{ period, timezone, window,
  totals, daily, byTask, byCategory }` envelope, read-only GET (no CSRF
  gate, no rate-limit bucket — cookie-authed safe-method read,
  issue 05 scope). Contract: finalized focus only (`completed|cancelled`,
  breaks + running/paused excluded); windows are rolling local days
  through the saved IANA timezone (calendar subtraction, never N*24h —
  DST-spanning vectors green) closed above at `now`; daily bars ascending
  oldest→today zero-filled; by-task groups by stable `taskId`
  (newest snapshot wins, null = Unassigned) and by-category by resolved
  category (null = Uncategorized), both minutes-desc; rate null and
  average null on empty (explanatory copy stays in issue 16, No UI here);
  completed-tasks counts live `completed` rows by `completedAt` in window
  (deleted tasks stay reportable via session snapshots, not this count);
  snapshots resolve stored-wins-then-live (null renders
  Unassigned/Uncategorized); leak-free scoping (empty 200, never hints),
  bad periods 400. Code-review (2 axes): no hard violations on either
  axis; kept with rationale: default `7d` (history and analytics agree on
  first paint), response superset (`timezone`/`window`/`cancelledFocusIntervals`/
  per-bucket `intervals` justify the prototype's summary line + daily
  table), `lib/analytics` folder + duplicated window math (each lib owns
  its math next to the query it constrains, pinned to identical DST
  vectors), Kiritimati UTC+14 for the date-line vector (same as history,
  stricter than ±12), invalid-zone UTC fallback (mirrors history; column
  validated at registration/settings). Full suite: 570/571 with 1
  unrelated flaky timeout (`lib/auth/service.test.ts` password-reset,
  bcrypt under parallel load — passes 16/16 in isolation; change is purely
  additive, no existing files touched).
