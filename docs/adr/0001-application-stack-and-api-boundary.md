# ADR-0001: Application stack and API boundary

Status: accepted (2026-09-07; toolchain line superseded by ADR-0004 — Node.js 26)

## Context

Solo dev + agents, private beta <50 / year-1 <1k, minimal/free-tier budget, no
hard beta date, no region lock. Must run on Vercel **and** own VPS **and** local
Debian 13 (portable Docker). Server-authoritative timer with atomic transitions,
idempotent finalization, and explicit 409 conflicts. Strict TypeScript. WCAG 2.1
AA with accessible chart equivalents. See [Choose application stack and API
boundary](../.scratch/focusflow-mvp/issues/06-choose-application-stack-and-api-boundary.md).

## Decision

- Framework: Next.js App Router + strict TypeScript.
- API boundary: REST API routes per `PRODUCT_SPEC.md` §11 (not Server Actions).
- Toolchain: pnpm + Node.js 22 LTS (superseded: Node.js 26 per ADR-0004).
- Validation: Zod on every external input / API boundary.
- Charts: native SVG + HTML tables; no chart library.
- Styling: Tailwind CSS + shadcn/ui on Radix primitives (locked 2026-09-07
  with the UI prototype; dark theme default, remembered light toggle).

## Consequences

- Positive: best agent-example pool; explicit 409/idempotency semantics that are
  easy to integration-test; portable to future clients; zero chart bundle cost
  with full a11y control; repeatable `next build && next start` in Docker.
- Negative: App Router learning curve; serverless cold starts (explicitly
  excluded from p95 targets); must avoid Edge-only APIs to stay portable.
- Follow-up: system design must keep timer logic in Node runtime routes only.
