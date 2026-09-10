# ADR-0004: Node.js toolchain upgrade 22 → 26

Status: accepted (2026-09-10)

Supersedes the toolchain line of ADR-0001 ("pnpm + Node.js 22 LTS");
everything else in ADR-0001 stands.

## Context

Dependabot proposed `node:26-bookworm-slim` for the Dockerfile (PR #6),
while ADR-0001, `package.json` engines, `.nvmrc`, and CI all pin Node.js
22. Node 22 is fine but no longer the newest LTS-capable line, and staying
pinned means the Docker image, CI runtime, and local toolchain drift apart
over time. Docs confirm no blocker: Next.js 16 requires Node >= 20.9 only,
and Prisma supports all maintained Node lines (no upper cap documented).
The full CI suite (typecheck, vitest on live Postgres, Playwright) runs on
the new runtime, so compatibility is proven empirically, not assumed.

## Decision

- Runtime: Node.js 26 everywhere — `package.json` engines (`26.x`),
  `.nvmrc`, CI `setup-node` version, and the Dockerfile base image
  (`node:26-bookworm-slim`, taking over Dependabot PR #6, which closes as
  superseded).
- Types: `@types/node` major-bumped in step (`^22` → `^26`), lockfile
  updated via `pnpm install`.
- pnpm stays at 10.17.0 (only the Node runtime moves).

## Consequences

- Positive: single Node line across local dev, CI, Vercel, and Docker;
  Dependabot Node bumps apply cleanly again.
- Negative: local checkouts still on Node 22/24 see an engines warning
  until they `nvm use`; CI is the source of truth for the new runtime
  until every dev upgrades.
- Follow-up: none — PR #6 closes as superseded by this change.
