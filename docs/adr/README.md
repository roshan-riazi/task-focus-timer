# ADRs

Accepted architecture decisions for FocusFlow. Product scope lives in
`../product/PRODUCT_SPEC.md`; per-decision rationale lives in the linked
wayfinder tickets.

- [ADR-0001: Application stack and API boundary](0001-application-stack-and-api-boundary.md) — Next.js strict TS, REST, pnpm + Node 22, Zod, native SVG.
- [ADR-0002: Data, auth, and deployment foundation](0002-data-auth-deployment-foundation.md) — Neon + Prisma, Auth.js v5, Vercel + portable Docker, lazy reconcile.
- [ADR-0003: Quality and operations backbone](0003-quality-operations-backbone.md) — Vitest + Playwright, logs + scrubbed errors (no analytics), GHA + scanning, portable resilience.
- [ADR-0004: Node.js toolchain upgrade 22 → 26](0004-node-toolchain-upgrade-26.md) — Node 26 everywhere; supersedes ADR-0001's toolchain line, closes Dependabot PR #6 as superseded.
