Status: open
Milestone: 3
Depends on: 10

## Scope

Cycle + reconcile rules in one transaction: full-expiry increments cycle,
complete-early doesn't; long-break propose/reset/skip; lazy expiry reconcile
(auto <60 min, Complete/Discard confirm beyond); settings cutover to new
intervals only. No UI.

## Acceptance

- All §8.5 rules + 60-minute confirm paths behave per spec; no duplicate
  history/analytics rows on any reconcile path.

## Validation

- API with clock travel: expiry auto vs confirm, Discard semantics,
  cycle increments exactly once. E2E: confirm dialog both choices (needs 13).

## Comments
