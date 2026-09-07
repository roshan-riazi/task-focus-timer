Status: open
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
