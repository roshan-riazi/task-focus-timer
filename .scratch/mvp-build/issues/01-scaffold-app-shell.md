Status: done
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

- 2026-09-07: implemented on branch `01-scaffold-app-shell` (TDD at agreed
  seams: health route, env schema, theme toggle — 11/11 Vitest green;
  `typecheck` + `lint` clean; `pnpm dev` and `next build && next start`
  both serve `/` → 200 and `/api/health` → `{"status":"ok"}`).
  `docker compose up` NOT run here (no Docker daemon in sandbox);
  Dockerfile + compose YAML-validated — verify on Debian 13 host.
  Code-review (inline, sub-agents unreachable): no hard violations;
  health skeleton omits DB reachability by design (lands in 03/06).
  `skills-lock.json` + `.agents/skills/tdd/` changes are pre-existing
  environment noise, left uncommitted.
