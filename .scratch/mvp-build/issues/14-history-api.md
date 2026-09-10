Status: done
Milestone: 4
Depends on: 07, 10

## Scope

History API per spec §11.3: reverse-chron paginated sessions with snapshots,
Today/7d/30d + focus/all filters, opaque `(started_at, id)` cursors.
Read-only. No UI.

## Acceptance

- Deleted-task sessions stay legible; breaks filterable; pagination stable
  under inserts.

## Validation

- API: filters, cursors, snapshot integrity, scoping. E2E: filter journeys
  (needs 16).

## Comments

- 2026-09-10: implemented on `main` (TDD at agreed seams mirroring 07/10:
  validation-Zod, service-over-ports, HTTP handlers hermetic, live-DB
  integration — 34 history tests green; full suite 537 passed on live PG;
  `typecheck` + `lint` clean). Route: `GET /api/sessions`
  (`period=today|7d|30d` default `7d`, `type=focus|all` default `all`,
  `limit` default 20 cap 100, opaque base64url cursor over
  `(started_at, id)`), `{ sessions, nextCursor }` envelope, read-only GET
  (no CSRF gate, no rate-limit bucket — cookie-authed safe-method read,
  issue 05 scope). Contract: finalized (`completed|cancelled`) only;
  windows are rolling local days through the saved IANA timezone
  (calendar subtraction, never N*24h — DST-spanning vectors green) closed
  above at `now`; keyset `startedAt DESC, id DESC` stable under inserts;
  snapshots resolve stored-wins-then-live (null renders "Unassigned"),
  so the 07 backfill and later renames never rewrite history; leak-free
  scoping (empty 200, never hints), forged cursors 400. Code-review
  (2 axes): removed speculative `appUrl` from the read-only handler deps
  + dead test scaffolding, closed the window above at `now`
  (future-dated rows excluded); kept with rationale: `period` instead of
  `from`/`to` (this issue's scope supersedes the §11.3 example; unknown
  keys strip per repo Zod default), response superset
  (`plannedDurationSeconds` justifies the prototype's "Completed early"
  row; `expectedEndAt`/`taskId` ride the timer shape for issue 16),
  `lib/sessions` folder vs `History*` types (route-aligned vs
  domain-aligned, same split as tasks/timer libs). E2E filter journeys
  stay in issue 16.
