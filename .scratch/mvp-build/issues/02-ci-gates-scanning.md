Status: in_review
Milestone: 1
Depends on: 01

## Scope

GitHub Actions: typecheck, lint, audit, `prisma migrate deploy` against a
test DB, Vitest, Playwright, Gitleaks — fail-closed. Dependabot on.

## Acceptance

- Every gate required to merge; a deliberately failing commit is blocked.
- Test Postgres migrates from zero on every run.

## Validation

- Push a canary branch proving gates run and block on failure.

## Comments

- 2026-09-07: implemented on branch `01-scaffold-app-shell` (TDD at agreed
  seams: CI-config/audit/scan assertions in `tests/ci-gates.test.ts` — 11/11
  green; slices red→green recorded). Delivered: `.github/workflows/ci.yml`
  (8 jobs: typecheck, lint, audit, migrate, vitest, playwright, gitleaks +
  `ci-required` aggregator; postgres:16 service + `prisma migrate deploy`
  from zero in migrate/vitest/playwright; browsers installed before
  `playwright test`; gitleaks-action@v3 with full-history checkout),
  `.github/dependabot.yml` (npm/github-actions/docker, weekly),
  `gitleaks.toml` (default ruleset, fail-closed), `playwright.config.ts`
  (chromium+firefox+webkit) + `e2e/smoke.spec.ts` (`/` heading,
  `/api/health` up-envelope), `package.json` scripts
  (audit/db:migrate/db:validate/test:e2e) + pnpm overrides forcing patched
  mysql2>=3.23.1/deepmerge-ts>=8 (upstream prisma@7.10.0 transitives;
  `prisma validate` + `generate` re-verified after override).
- Canary evidence (no remote configured, so proven locally instead of a
  pushed canary branch): typecheck fails on a deliberate type error (exit 2)
  and the error names the file; `pnpm audit` failed pre-override (3 vulns:
  2 high + 1 moderate, exit 1) and passes post-override (exit 0); gitleaks
  8.30.1 local scan: 0 findings in tracked files (14 hits all in gitignored
  `.next/` build output, never committed); `playwright test --list` resolves
  6 tests (2 specs x 3 browsers); `lint` clean.
- Code-review (two-axis sub-agents): Standards — fixed job-id/name mismatch
  (unit-test→vitest, e2e→playwright), added `migrate deploy` to the vitest
  job per TEST_STRATEGY §2, pinned gitleaks-action@v3 (v2 dies with the
  Node-20 runner removal 2026-09-16) + checkout@v6, extracted readPkg/jobBlock
  helpers. Deferred with rationale: composite-action dedup (MVP scale),
  320/768/1280 viewport projects (issues 12/17), timezone-vector/canary
  fail-closed CI checks (no such tests exist yet — issues 06/11/14/15).
  Human setup still required: repo Settings → require `ci-required` + all
  gate checks on `main`; add GITLEAKS_LICENSE secret for org repos.
- Concurrency note: issues 03/05/06 landed in the same tree mid-session
  (full prisma schema + 143-line migration superseded this issue's empty
  baseline — intended handoff; `prisma.config.ts` keeps v7 valid). Pre-existing
  tree red at commit time, all out of scope: `lib/request-id.test.ts`
  imports removed `getRequestIdHeader` (1 vitest failure + `next build`
  type-check failure), `middleware.ts` pulls node:crypto into Edge runtime
  (build warning). No local Postgres/Docker here, so migrate-from-zero and
  browser e2e first run in CI.
- 2026-09-08 close-out: owner confirmed personal repo (not org) → dropped
  GITLEAKS_LICENSE from the gitleaks job (personal repos scan without it).
  The concurrent agents fixed their side meanwhile (`request-id` mismatch
  resolved, tree converged): full verification green — `typecheck` clean,
  `lint` clean, `pnpm audit` clean (exit 0), Vitest 61 passed / 3 skipped
  (DB-gated constraints skip without DATABASE_URL) / 0 failed,
  `tests/ci-gates.test.ts` 11/11, `next build` passes (Edge node:crypto
  trace is a non-fatal warning), gitleaks 8.30.1 with auto-detected
  `gitleaks.toml`: 0 findings in tracked files (22 hits all in gitignored
  `.next/` build output). Remaining human setup: repo Settings → require
  `ci-required` + all gate checks on `main` (no remote configured here, so
  the canary-push validation and first CI run happen on push).
