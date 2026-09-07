# Triage labels

`Status:` line values for issue files under `.scratch/` (both the wayfinder
map in `focusflow-mvp/` and the build tracker in `mvp-build/`).

## Build issues (`mvp-build/`)

- `open` — specified, unclaimed, ready when `Depends on:` is satisfied.
- `in_progress` — claimed by one driver; set before any work starts.
- `in_review` — work complete, waiting on review/verification.
- `done` — Validation satisfied, CI green, merged.
- `blocked` — cannot proceed for reasons outside its dependencies; explain
  in `## Comments`.

## Wayfinder tickets (`focusflow-mvp/`)

- `open` — unclaimed frontier candidate.
- `claimed` — a session owns it (assignee-equivalent; set first).
- `resolved` — answer recorded under `## Answer`, map updated.

Progress conversation and review history append under `## Comments`; final
answers (wayfinder) go under `## Answer`, never in comments.
