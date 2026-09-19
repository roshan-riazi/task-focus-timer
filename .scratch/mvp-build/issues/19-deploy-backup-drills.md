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
