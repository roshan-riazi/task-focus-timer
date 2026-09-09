Status: in progress
Milestone: 2
Depends on: 07

## Scope

Task UI per prototype `workspace.html`: sidebar list + quick-add, select for
focus, complete/reopen/archive/delete, filters, loading/empty/error states.
Desktop left-column; mobile below timer. Full keyboard operation. No timer
logic.

## Acceptance

- All M2 task acceptance criteria pass with keyboard only and at 360px +
  desktop widths.

## Validation

- E2E: task journeys (keyboard-only run), empty/error states, mobile layout.
  Axe on task views.

## Comments

- 2026-09-09: implemented on branch `08-task-ui` (TDD at agreed seams:
  tasks-API client with stubbed fetch, TaskPanel/TaskItem/Workspace via
  Testing Library against public roles with a stateful in-memory task
  server, `/app` gate + responsive layout via Playwright — 41 task UI
  unit tests + 5 e2e green; full vitest 284 passed; `typecheck` + `lint`
  clean; `audit` exit 0 (2 pre-existing scoped ignores); e2e 7/7 on
  chromium incl. pre-existing auth journey; axe zero violations at 1280px
  + 320px). Ships: `components/tasks/` (api client, TaskPanel with
  quick-add/filters/pagination/load-more, TaskItem with
  select/complete/reopen/edit/archive/unarchive/two-step-delete/move-up-down,
  Workspace), `app/app/page.tsx` (session gate → /login) + `Focus` primary
  nav, `e2e/tasks-journey.spec.ts` (keyboard-only lifecycle incl.
  logout→login persistence per §13.1, empty/error/retry, signed-out
  redirect, 320px geometry, axe). Also: PATCH accepts explicit null to
  clear notes/category (issue 07 contract gap — "" meant absent/skipped,
  so clearing was a silent no-op; service already handled null).
  Code-review (2 axes) dispositions: fixed — 320px viewports (STRATEGY
  §1/§4 over ticket's 360px), full-AA axe gate (was serious+), completed
  pagination with partial-set reorder guard, stale-selection sweep,
  null-clear, row-action hygiene (union kind, shared error factory,
  AuthField reuse), primary-nav landmark, grid min-w-0 320px overflow
  (2px, found by probe). Deferred with rationale: `/app/tasks`
  standalone route (prototype embeds tasks in Focus; history/analytics/
  settings routes + full nav land together in issue 16 — no forked task
  UX now), api/use-auth-submit envelope dedup + panel mutate-shape dedup
  (judgement-call duplication across seams; follow-up, not M2), edit +
  reorder + archived/all filters beyond the ticket's literal list (all
  required by M2 exit §14 / shipped 07 API surface). Flake notes:
  testing-library asyncUtilTimeout 1s→5s (parallel-worker starvation,
  never fails isolated); one pre-existing bcrypt timeout flake in
  `lib/auth/service.test.ts` under full-suite load (16/16 isolated,
  untouched by this diff). Awaiting CI incl. firefox/webkit (only
  chromium installed locally); merge only when green.
