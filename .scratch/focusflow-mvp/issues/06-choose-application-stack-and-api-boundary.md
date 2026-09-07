Status: resolved
Type: grilling
Blocked by: 01, 05

## Question

Choose the application stack and API boundary: application framework + version, package manager + Node.js version, runtime schema-validation library, whether timer APIs use REST endpoints / server actions / another boundary (spec §11 proposes REST), and whether charts need a library or lightweight native rendering suffices?

Recommend a coherent stack that supports server-authoritative timestamps, atomic timer transitions, strict TypeScript, and WCAG 2.1 AA chart equivalents, with ADRs for each consequential choice.

## Answer

- Next.js App Router + strict TS; REST API routes per spec §11 (explicit 409/idempotency, testable).
- pnpm + Node 22 LTS; Zod validation; native SVG + tables, no chart lib.
- ADRs pending for framework/API/validation/charts (to be written before Milestone 1). No spec change (stack is architecture, not product scope).
