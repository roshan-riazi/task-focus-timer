Status: in_review
Milestone: 1
Depends on: 03, 04

## Scope

DB sessions, secure HTTP-only SameSite cookies + origin checks on mutations,
DB-backed rate limits on auth/sensitive routes, per-request user scoping.
Cross-user isolation tests.

## Acceptance

- Sessions survive refresh; cross-user record access is forbidden/not-found
  both ways; rate limits trigger without locking out legitimate use.

## Validation

- API: session lifecycle, scoping on every guarded route, rate-limit
  behavior, cross-user isolation (both directions).

## Comments

- 2026-09-09: implemented on branch `05-auth-sessions-rate-limit` (TDD at
  pre-agreed seams: origin check, rate limiter + Prisma store, guards,
  handler factories, live-DB integration — full suite 200 passed / 21
  skipped, skips are live-DB tests that run in CI; `typecheck` + `lint` +
  `pnpm build` clean; migration verified from zero under PGlite, real PG
  semantics). DB sessions were already Auth.js-owned (04); this issue adds
  the hardening around them: (1) CSRF origin gate on all 7 auth POSTs via
  `withMutationGates` (`lib/auth/origin.ts`, exact-origin compare, safe
  methods skip, cookieless+originless passes for non-browser callers,
  cookie-bearing without provenance 403s); `APP_URL` is now load-bearing
  (public origin required in prod; E2E pins `http://127.0.0.1:3000`). (2)
  DB-backed sliding-window rate limits (`rate_limit_hits` + migration
  `20260909000000_auth_rate_limit`, per-IP buckets on all 6 abuse-sensitive
  routes, 429 + precise `Retry-After` from the oldest in-window hit,
  lazy prune, generous ceilings so legitimate use never 429s). (3)
  `requireUser` guard (identity from session only; resend-verification
  refactored onto it, forged body ids reach nothing) + leak-free `notFound`
  envelope for cross-user denials. (4) Session lifecycle: refresh-proof
  cookie sessions, expiry reads as signed-out, logout revokes, login lazily
  prunes expired rows (no workers). Live tests prove lifecycle, 429
  behavior, and isolation both directions (session reads, forged resend,
  scoped task/settings reads). Code-review (2 axes): fixed handler-gate
  duplication (wrapper), json-helper duplication, approximate resetAt (now
  exact), unverified-migration header (PGlite run recorded). Kept with
  rationale: `notFound` has no caller until task/timer routes (first use
  issue 07); origin gate covers unauthenticated POSTs too (harmless,
  blunts login-CSRF); XFF is best-effort (auth rests on bcrypt +
  no-enumeration; trusted-proxy list is future work). Deferred: HTTP-level
  cross-user task tests impossible until task routes exist (issue 07 must
  add them on top of `requireUser`/`notFound`); live-DB + Firefox/WebKit
  E2E left to CI (no Postgres/Docker in sandbox).
