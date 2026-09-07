Status: open
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
