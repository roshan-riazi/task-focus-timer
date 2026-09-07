Status: open
Milestone: 1
Depends on: 01

## Scope

Request-ID structured logs (pino), scrubbed Sentry errors (no task
titles/notes anywhere), `/api/health` (DB check, no user data). Confirm Neon
retention vs the 30-day backup-expiry copy.

## Acceptance

- `/api/health` 200 with DB up / 503 without leaking internals.
- Canary fixture strings appear nowhere in logs, error reports, or payloads
  outside first-party API bodies.

## Validation

- Integration: health states, canary-scrub assertions. Manual: Sentry event
  review before beta.

## Comments
