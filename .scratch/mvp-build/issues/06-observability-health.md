Status: in_review
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

- 2026-09-08: implemented on branch `01-scaffold-app-shell` (TDD at seams:
  `lib/request-id` + middleware, `lib/log` (pino), `lib/errors` (scrub),
  `GET /api/health` via `lib/health` factory with injected `DbCheck` —
  23/23 targeted Vitest green; full suite 61 passed / 3 skipped (live-DB
  constraints skip without DATABASE_URL); `tsc --noEmit --incremental false`
  + `eslint` clean).
  - Health: 200 `{status:"ok",checks:{db:"up"}}` on `SELECT 1` via the shared
    Prisma client (`lib/db.ts` singleton, also unblocking 03's import seam);
    503 `{status:"error",checks:{db:"down"}}` on any failure, request ID
    echoed/generated, no user data, no internals. Lazy client import keeps
    route module-load hermetic.
  - Scrub contract: `lib/sensitive-fields.ts` is the single source (titles,
    notes, category, snapshots, secrets); pino redaction + error scrub derive
    from it. Free-form strings (error `msg`, exception values) can only be
    pattern-scrubbed (connection strings, Bearer tokens) — never interpolate
    task content into messages; enforced by canary tests + review.
  - Sentry: `sentryBeforeSend` drops request bodies/cookies/user and
    deep-scrubs the rest; wire as `beforeSend` when the SDK lands. No SDK
    added yet (ADR-0003 suggestion, not locked).
  - Code-review (2 axes): fixed middleware not propagating the ID into
    forwarded request headers; hardened `ensureRequestId` (trim, strip
    CR/LF, cap 128); removed `getRequestIdHeader` wrapper; added bare
    `category` to scrub lists; shared canary fixtures (`tests/canary.ts`).
    Remaining review notes accepted as documented: Neon confirm + Sentry
    event review stay manual pre-beta gates; `toPublicError` kept as the
    SYSTEM_DESIGN §6 envelope seam for upcoming API issues; 3s health timeout
    is deliberate reliability policy.
   - Neon retention vs 30-day copy: docs caps are Free 6h (1 GB), Launch ≤7d,
     Scale ≤30d — the published 30-day backup-expiry copy requires the Scale
     plan at a 30-day history window, or pg_dump-to-remote artifacts with
     30-day retention. Recorded in RUNBOOK §4; dashboard re-confirm + restore
     drill stay pre-beta manual items (RUNBOOK §§4,7).
- 2026-09-08: status returned to `in_review` (was `done`): this issue's own
  Validation requires a **manual Sentry event review before beta**, and its
  acceptance assumes scrubbed Sentry errors, but no Sentry SDK is wired yet
  (`sentryBeforeSend` is unit-tested, not live). Everything CI-provable is
  green (health states, canary-scrub, e2e health envelope). Close-out needs:
  (1) wire the SDK with `beforeSend`, (2) one manual scrubbed-event review,
  or an explicit decision re-scoping `done` to pipeline-only.
