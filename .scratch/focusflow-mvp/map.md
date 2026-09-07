## Destination

An approved, implementation-ready FocusFlow MVP definition — clarified `docs/product/PRODUCT_SPEC.md` + `CONTEXT.md` + ADRs + dependency-aware implementation plan in the tracker — with nothing left to decide before build starts.

## Notes

- Domain: personal productivity (task list + Pomodoro focus timer + individual descriptive analytics). Single-context repo. Vocabulary lives in `CONTEXT.md` once created; use its terms, don't drift to synonyms.
- Authority: `docs/product/PRODUCT_SPEC.md` is authoritative for product scope unless superseded by an accepted ADR or explicitly approved product change.
- Source spec (don't duplicate here): `docs/product/PRODUCT_SPEC.md` v1.0 (`draft-for-wayfinding`, 2026-09-05) — §§2–5 hold destination, settled decisions, success criteria, and in/out scope; §6 holds timer defaults; §§8/13 hold functional rules and acceptance criteria. Read the spec for detail; this map holds only gists + links.
- Source of truth: product scope → spec; domain language → `docs/product/CONTEXT.md`; durable tech choices → `docs/adr/`; per-decision detail → linked ticket body + Answer. A decision lives in exactly one place; the map never restates it.
- Way of working: plan, don't do — each ticket resolves a decision, not a slice of build. Produce decisions, not deliverables, unless Notes are overridden.
- Every session: read `AGENTS.md`, `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, this map (low-res view only), and the claimed ticket body. Zoom to related/closed tickets on demand.
- Refer by name: in narration and Decisions-so-far, refer to maps/tickets by title with link inside the name, never by bare id/number/slug.
- Skills: `wayfinder` drives the map. Where available, use `grilling` + `domain-modeling` for HITL decisions, `research` for AFK fact-finding, `prototype` for cheap concrete artifacts. This repo currently only has `wayfinder` + `setup-matt-pocock-skills` installed — work HITL via conversation when those skills are absent.
- Tracker: local-markdown — map is `.scratch/focusflow-mvp/map.md`, tickets are `.scratch/focusflow-mvp/issues/NN-<slug>.md`. `Blocked by:` wires the frontier; `Status:` is `open` / `claimed` / `resolved`; `Type:` is `research` / `prototype` / `grilling` / `task`.
- Standing preferences for this effort: small prioritized question groups, one decision at a time, each with options + trade-offs + recommendation; update `PRODUCT_SPEC.md` after product clarification; no implementation until destination, architecture, and first milestone are approved.

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [Approve the destination and MVP boundary](issues/01-approve-destination-and-mvp-boundary.md): destination approved as implementation-ready MVP definition, personal-productivity scope locked, decisions-only until handoff.
- [Lock timer and cycle semantics](issues/02-lock-timer-and-cycle-semantics.md): only full expiry advances cycle; 60-min confirm threshold for expiry-while-closed; breaks persisted; settings apply to new intervals only.
- [Lock auth and account lifecycle](issues/03-lock-auth-and-account-lifecycle.md): verification non-blocking; immediate live purge + 30-day backup expiry; completed retained until delete; managed auth preferred.
- [Lock analytics and presentation scope](issues/04-lock-analytics-and-presentation-scope.md): rolling 7 local days; English-only i18n-ready; FocusFlow locked minimal identity; bar + lists sufficient.
- [Confirm delivery constraints](issues/05-confirm-delivery-constraints.md): solo + agents, <50 beta / <1k y1, free-tier, no hard date, no region lock, free product, repo deferred-private, no product analytics.
- [Choose application stack and API boundary](issues/06-choose-application-stack-and-api-boundary.md): Next.js strict TS, REST routes, pnpm + Node 22, Zod, native SVG + tables; ADRs pending.
- [Choose data, auth, deployment foundation](issues/07-choose-data-auth-deployment-foundation.md): Neon + Prisma, Auth.js v5 DB sessions, Vercel primary + portable Docker for VPS/Debian, lazy reconcile no workers.
- [Choose quality and operations backbone](issues/08-choose-quality-operations-backbone.md): Vitest + Playwright + Testing Library; logs + scrubbed errors, no analytics; GHA + Dependabot + Gitleaks; DB rate limit + hardened cookies + Neon backups + /api/health + migrate deploy.

## Not yet specified

<!-- in-scope fog you can't ticket yet; graduates as the frontier advances -->

- Detailed system design (module boundaries, project layout, migration strategy) — needs stack + data/auth decisions first.
- Test strategy mapping risks/requirements to unit/integration/e2e suites — needs stack + timer-semantics decisions first.
- Operations runbook (deploy, rollback, backup/restore, incident) — needs deployment/observability decisions first.
- Exact API error envelope, pagination cursor shape, and idempotency-key mechanism — needs API-boundary decision first.
- Accessibility audit plan and chart accessible-equivalent patterns — needs charts + frontend stack decisions first.
- Workspace UI prototype via `anthropics/skills@frontend-design` (deferred until foundation done; constrain to locked minimal identity, WCAG 2.1 AA, native SVG + tables, Next.js) — graduates into a `prototype` ticket after data/auth/deployment + quality backbone resolve.
- Milestone slicing and dependency-aware implementation plan — needs all frontier decisions resolved first.

## Out of scope

<!-- work ruled beyond the destination; closed, never graduates -->

- Teams, shared tasks/projects, manager dashboards, employee monitoring, public profiles, social/leaderboards — collaboration/surveillance excluded from MVP per spec §5.2.
- Projects/subtasks/dependencies/kanban/Gantt, calendar + third-party task integrations, billing/subscriptions — excluded per spec §5.2.
- Native mobile/desktop apps, offline sync, real-time cross-device sync via WebSockets — excluded per spec §5.2.
- AI recommendations, predictive analytics, automatic site/app tracking, manual editing of historical durations, custom reporting dashboards — excluded per spec §5.2.
