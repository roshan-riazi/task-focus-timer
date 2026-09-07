Status: open
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
