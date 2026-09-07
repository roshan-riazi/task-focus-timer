Status: open
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
