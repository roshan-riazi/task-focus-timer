# FocusFlow — System Design

Status: accepted (2026-09-07; owner approved incl. §10 defaults)

Sources: `docs/product/PRODUCT_SPEC.md` (product authority), `docs/adr/`
(accepted architecture), `docs/product/CONTEXT.md` (domain language).

## 1. Runtime topology

- Single Next.js App Router app (Node.js 22 runtime for all timer/auth routes;
  no Edge-only APIs, per portability).
- One Neon Postgres database via `DATABASE_URL` (Neon cloud in prod, container
  Postgres locally / on VPS). Prisma is the only data-access path.
- One artifact, three targets: Vercel (primary) + portable Docker
  (`output: standalone`, `next start`) on own VPS + local Debian 13.
- No background workers, no WebSockets. Expired timers reconcile lazily on the
  next server interaction (spec §8.4 + 60-minute confirm rule).

## 2. Project layout (proposed)

```text
app/
  (public)/{login,register,forgot-password,reset-password}
  app/{page,tasks,history,analytics,settings}   # authenticated workspace
  api/{tasks,timer,sessions,analytics,settings,health}/route.ts
lib/{db,auth,timer,analytics,rate-limit,log}.ts
components/{tasks,timer,history,analytics,ui}/
prisma/{schema.prisma,migrations}/
Dockerfile + docker-compose.yml (app + local Postgres)
```

Server components for reads; client components only where interactivity demands
(timer display tick, quick-add, dialogs). Client ticks never author elapsed time.

## 3. Authentication (Auth.js v5, DB sessions)

- Email + password (8-char min unless provider stronger) + verification email
  sent at registration but **non-blocking** (nag banner until verified).
- Sessions in Postgres (single-DB purge story). Secure HTTP-only SameSite
  cookies; origin verification on cookie-authenticated mutations (CSRF).
- Every query scoped to session user; no endpoint accepts arbitrary user IDs.
- Auth/sensitive endpoints behind DB-backed rate limiting (portable; Redis
  later if needed). Email sending via env-pluggable provider (Resend suggested —
  **proposed default, not locked**).
- Account deletion: explicit confirm → immediate live purge (user, settings,
  tasks, sessions, cycle state) → backups age out in 30 days per policy.

## 4. Timer state machine (server-authoritative)

States: `running | paused | completed | cancelled` (+ idle = no active row).
Interval types: `focus | short_break | long_break`.

Transitions (all atomic, all server-computed, `409` on illegal move):

```text
idle --start--> running --pause--> paused --resume--> running
running|paused --complete--> completed
running|paused --cancel--> cancelled        # incl. Discard from confirm dialog
```

- `start` reads planned duration from saved settings; client sends only
  `intervalType` + optional `taskId`. Partial unique index guarantees at most
  one active row per user; violation surfaces as `ACTIVE_TIMER_EXISTS`.
- Stored per session: `started_at`, `expected_end_at`, `paused_at`,
  `accumulated_pause_seconds`, planned + actual durations, completion /
  cancellation stamps. Remaining time is always derived from timestamps.
- Pause math: pausing freezes accrual (`paused_at` set); resume adds
  `now - paused_at` to `accumulated_pause_seconds` and shifts `expected_end_at`
  forward by the same amount. Paused time never counts toward actual duration.
- Finalize (complete/cancel/skip-break): single transaction that (a) sets final
  status + `actual_duration_seconds`, (b) writes task/category snapshots, (c)
  on full-expiry focus completion increments `focus_cycle_state`, (d) is
  idempotent — see §6. Completing a long break (or skipping it) resets the
  cycle count. `Complete early` records actual minutes as completed but does
  **not** increment the cycle count. Breaks never contribute focus minutes.
- Expiry while away: within 60 min past `expected_end_at` → auto-finalize as
  completed on next contact; beyond 60 min → client shows Complete/Discard
  confirm, then finalizes once. No duplicate history/analytics rows ever.
- Settings edits apply to newly created intervals only.

## 5. Tasks

- Fields per spec §10.3 (title ≤200, notes ≤2000, single category ≤50,
  `active|completed|archived`, position, UTC stamps, soft-delete).
- Completing stamps `completed_at` and leaves the active view (filterable,
  reopenable). Deleting preserves session snapshots (`task_title_snapshot`,
  `category_snapshot`). A task linked to a running/paused interval is
  immutable until that interval finalizes. Unassigned intervals allowed; UI
  nudges toward selection.
- Position: **proposed default** fractional ranking (float `position`,
  renormalize on read skew) — simple, portable, no extension needed.

## 6. API conventions (REST, per spec §11)

- JSON bodies; UTC ISO-8601 timestamps; Zod validation on all input; error
  envelope `{ error: { code, message } }`; `409` for timer conflicts
  (`ACTIVE_TIMER_EXISTS`, `NO_ACTIVE_TIMER`, `ALREADY_FINALIZED`,
  `TASK_LOCKED_BY_TIMER` — proposed code set).
- Finalize idempotency: **proposed default** client-sent `Idempotency-Key`
  header on complete/cancel/skip-break, stored with a short TTL; retries with
  the same key return the original outcome without double-counting the cycle.
- History pagination: **proposed default** opaque base64 cursor over
  `(started_at, id)` with `limit`; same shape for completed-task lists.
- Analytics: `GET /api/analytics/summary?period=today|7d`.

## 7. History & analytics

- History: reverse-chron, read-only, paginated; breaks persisted, `focus|all`
  filter controls display; rows carry snapshots so deleted tasks stay legible.
- Periods: Today = user's local calendar day; 7d = rolling 7 local days incl.
  today — never UTC days, never calendar weeks. All grouping converts stored
  UTC stamps through the saved IANA timezone (DST-safe; DST covered by
  acceptance tests).
- Metrics per spec §8.9 (completed minutes, interval count, completed tasks,
  completion rate, daily bars, by-task/by-category, average duration).
  Computed from source rows per request (personal scale; <1k users); no
  pre-aggregated store in MVP.
- Presentation: daily SVG bar chart + ranked lists + full table/text
  equivalents (locked sufficient scope); explanatory empty states;
  English-only strings, externalized for future i18n.

## 8. Deployment & operations

- Env config only: `DATABASE_URL`, `AUTH_SECRET`, email provider keys, error
  monitoring DSN. Secrets never in source (Gitleaks enforced).
- Migrations: `prisma migrate deploy` in CI and container entrypoint;
  repeatable, forward-only.
- Health: `GET /api/health` checks DB reachability, returns no user data.
- Backups: Neon automated backups (+ `pg_dump` path on VPS); live purge
  immediate, backup expiry 30 days — restore procedure goes in RUNBOOK.
- Observability: request-ID structured logs + scrubbed error reports; **no**
  product-analytics telemetry (suggested §4 metrics are DB aggregates only).
  No task titles/notes in any log, report, or telemetry.

## 9. Security, privacy, accessibility baselines

- Per-user scoping, server-side transition validation, rate limits, hardened
  cookies, HTTPS-only prod, dependency + secret scanning in CI.
- WCAG 2.1 AA: keyboard-complete flows, visible focus, announced timer-state
  changes (not every tick), no color-only meaning, contrast, reduced-motion,
  focus-managed dialogs, field-associated errors.

## 10. Proposed defaults needing owner sign-off

1. Email provider = Resend (any SMTP-compatible satisfies the design).
2. Co-locate Vercel + Neon in EU (configurable; no residency lock).
3. Fractional task `position` with renormalization.
4. `Idempotency-Key` header + opaque `(started_at, id)` cursor (codes above).
5. Sentry free-tier for scrubbed errors (any equivalent with scrubbing works).

## 11. Traceability

- Milestone 1: §§2–4 auth/schema/migrations + CI backbone.
- Milestone 2: §5 tasks + filters + keyboard/mobile.
- Milestone 3: §4 timer lifecycle + reconcile + sounds/notifications.
- Milestone 4: §7 history/analytics + a11y equivalents + DST tests.
- Milestone 5: §§8–9 audit, security review, backups, deletion flow, release.
