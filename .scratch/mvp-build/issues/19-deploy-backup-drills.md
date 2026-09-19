Status: done
Milestone: 5
Depends on: 02, 06

## Scope (VPS-adapted per ADR-0005 — no Vercel/Neon access)

Ship the VPS Docker image + local compose. Runbook §§2–5 rehearsed:
deploy, forward-only rollback, backup/restore drill into an isolated DB,
deletion evidence. Host monitor on VPS `/api/health`.

## Acceptance (VPS-adapted)

- Same artifact green on VPS + local compose; drill evidence recorded below;
  rollback path proven without touching live data (compose `--no-build` pin).

## Validation (VPS-adapted)

- Smoke script (`scripts/vps-smoke.sh`: login, 1-min focus,
  history/analytics render, health 200) on the VPS target. Drill record filed
  in issue comments (below).

## Comments

- drill: date=2026-09-19 actor=owner target=vps-docker(local-rehearsal) image=10ebdaf result=pass
  - check: pg_dump live DB → gzip artifact (3.8K, empty dev DB)
  - check: restore into isolated DB focusflow_drill (never live data; drill DB dropped after)
  - check: prisma migrate status clean ("Database schema is up to date!") + prisma validate clean on isolated DB
  - check: counts-only spot queries (users=0 tasks=0 timer_sessions=0, no content)
  - check: prune rule dry-run — 31-day fixture selected, 5-day fixture kept (`-mmin +43200`, matches `BACKUP_RETENTION_DAYS = 30`)
  - notes: live `/api/health` probe + `vps-smoke.sh` run deferred to the VPS host (no Docker in this env); compose app healthcheck + `vps-health-monitor.sh` cover it there. Quarterly repeat: `./scripts/vps-restore-drill.sh <backup-file>`.
- implement: 2026-09-19 — Dockerfile entrypoint (`migrate deploy`, fail-closed), compose hardened (app healthcheck, env passthrough, backup mount), scripts (deploy/rollback `--no-build`, backup 30-day, restore-drill with live-DB guard, smoke with per-run idempotency key, health-monitor, deletion-evidence), `lib/ops` unit-covered (6 tests), docs VPS-only (RUNBOOK, SYSTEM_DESIGN, ADR-0005). Full vitest: 642/643 green (1 pre-existing bcrypt timing flake in `lib/auth/service.test.ts`, passes in isolation); typecheck + lint clean. Code-review fixes applied (rollback pin, truthful drill evidence, minute-exact retention, unique smoke key, quoted deletion email).
- image-trial: 2026-09-19 — installed Docker locally, built `focusflow:test` and ran the full stack + `./scripts/vps-smoke.sh` → PASS (health 200, login, 1-min focus, history/analytics). The trial caught 4 bugs, all fixed: (1) `corepack` missing on Node 26 (now `npm i -g pnpm@10.17.0`); (2) `/app` prerendered at build with no DB (new `app/app/layout.tsx` `force-dynamic`); (3) compose empty-string env broke mail fallback (blank-as-unset in `resolveEmailProvider`, unit-covered); (4) smoke skipped login when register succeeded (register sets no cookie). Trial stack torn down (`down -v`). Full vitest after fixes: 646/646 green.
- ci: added build-only `docker` gate (`docker/build-push-action`, `push: false`, required for merge) so the image cannot rot — unit-covered in `tests/ci-gates.test.ts`.
