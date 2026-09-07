Status: open
Milestone: 1
Depends on: (none — first)

## Scope

Scaffold the runnable app shell: Next.js App Router + strict TS, pnpm +
Node 22, Tailwind + shadcn/ui, Zod, `output: standalone` Docker + compose
(app + local Postgres), env template (no secrets), base layout with dark
default + remembered light toggle, health route skeleton.

## Acceptance

- `pnpm dev`, `next build && next start`, and `docker compose up` all serve
  the app locally on Debian 13 paths.
- No Edge-only APIs; Node runtime on timer/auth routes.

## Validation

- Typecheck + lint clean (CI will enforce from 02 onward).
- Manual:./startup on all three paths renders the shell with no console errors.

## Comments
