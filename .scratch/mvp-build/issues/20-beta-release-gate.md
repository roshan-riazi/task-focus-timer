Status: open
Milestone: 5
Depends on: 10, 12, 14, 16, 17, 18, 19

## Scope

Beta gate: full registration-to-analytics journey, timer survives refresh +
inactivity, no multi-active or double-count under concurrency, no cross-user
leaks, DST-correct analytics, keyboard flows, desktop + mobile smoke on the
last two stable Chrome/Edge/Firefox/Safari, no excluded features required.

## Acceptance

- Definition of done (spec §15) checked line by line with evidence links.

## Validation

- Full CI + E2E matrix green; manual browser/device smoke log; perf smoke
  budgets met (3s view, p95 reads <500ms ex-cold-start, 1s reconcile).

## Comments
