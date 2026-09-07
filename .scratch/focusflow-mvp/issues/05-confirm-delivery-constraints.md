Status: resolved
Type: grilling
Blocked by: 01

## Question

Confirm delivery constraints that shape every technical choice: expected MVP budget, target beta date, team size/expertise, expected initial + first-year user counts, required hosting region/data-residency, whether the product is initially free, whether the repo is public or private, and whether anonymous product analytics are permitted?

Record the concrete constraints (or explicit "unconstrained/deferred" where none) so stack, hosting, observability, and security decisions can be sized correctly. No architecture ticket can resolve without this.

## Answer

- Team solo + agents; scale private beta <50, year-1 <1k (single-region, free-tier friendly).
- Budget minimal/free-tier; beta no hard date (quality-gated); region no constraints at all.
- Free initially; repo deferred (default private until explicit publish, keep publish-ready hygiene); anonymous product analytics NOT permitted (spec §12.5 updated to DB-aggregates only, no client events).
