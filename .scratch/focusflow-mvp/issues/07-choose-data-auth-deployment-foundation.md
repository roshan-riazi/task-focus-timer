Status: resolved
Type: grilling
Blocked by: 01, 05

## Question

Choose data, auth, and deployment foundation: relational database + hosting provider, ORM/SQL access strategy, authentication provider (managed vs. self-built), deployment platform + regions, and whether background-job/scheduled reconciliation is required for expired-timer handling (vs. lazy reconcile-on-next-interaction per spec §8.4)?

Decide the foundation that enforces per-user scoping, single-active-timer partial constraint, UTC storage with IANA-timezone reporting, transactional session+cycle updates, and repeatable migrations/backups.

## Answer

- Neon Postgres + Prisma (repeatable migrations, partial unique single-active-timer, transactional session+cycle, UTC storage).
- Auth.js v5 with DB sessions (one-DB purge story; non-blocking verification; email via env-pluggable provider, Resend suggested).
- Deployment: Vercel primary + portable Docker (`standalone` Node 22, `next start`) for own VPS + local Debian 13; Postgres via DATABASE_URL (Neon or local container); no Edge-only APIs, no vendor cron.
- Expiry: lazy reconcile on next interaction, no workers; 60-min confirm dialog covers absence. ADRs pending.
