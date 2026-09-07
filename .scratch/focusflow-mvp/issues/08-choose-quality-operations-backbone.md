Status: resolved
Type: grilling
Blocked by: 01, 05

## Question

Choose quality and operations backbone: unit/integration/e2e testing tools, logging/monitoring/product-analytics providers (with no task titles/notes in telemetry per spec §4), dependency/secret scanning in CI, rate-limiting + CSRF + backup strategy, and health-check/migration approach?

Define the backbone that lets Milestone 1 exit criteria (CI green, auth works in test, repeatable migrations, cross-user auth tests) and Milestone 5 release-readiness (a11y audit, security review, monitoring, deletion flow) actually be verified.

## Answer

- Vitest + Playwright + Testing Library (unit/integration + real-browser timer/refresh/keyboard/mobile).
- Logs (pino, request IDs) + scrubbed Sentry errors; NO product analytics per lock (DB-aggregates only).
- GitHub Actions + Dependabot + audit + Gitleaks (publish-ready hygiene).
- DB-backed rate limit (portable, Redis later) + origin-checked cookies/CSRF + Neon backups (30-day story) + /api/health + `prisma migrate deploy`. No spec change.
