Status: done
Milestone: 5
Depends on: 04, 05, 06

## Scope

Security review + privacy evidence: rate limits verified, CSRF/cookies,
server-side transition validation, error-shape leak check, dependency/secret
scans clean, deletion flow end-to-end (live purge verified, 30-day backup
copy published), privacy disclosures present.

## Acceptance

- Review checklist signed off; deletion-evidence procedure rehearsed once
  with timestamp + actor recorded.

## Validation

- API: leak checks, validation abuse cases. Manual: disclosure review,
  deletion drill.

## Comments

- 2026-09-10: implemented on branch `18-security-privacy-review` (TDD at
  pre-agreed seams: `deleteAccountSchema`, auth service + Prisma ports,
  `createDeleteAccountHandler`, live-DB purge, danger-zone component over
  stubbed fetch, keyboard-only E2E on the prod build).
  - New: `DELETE /api/account` (`app/api/account/route.ts` via auth
    `prodDeps({ rateLimitBucket: "account:delete" })`) — explicit
    server-side `DELETE` literal (`deleteAccountSchema`), session-derived
    identity (forged body ids reach nothing), CSRF origin gate + per-IP
    fixed window (5/hour) via the shared `withMutationGates` wrapper,
    single `user.delete` purge (all user-linked rows cascade), cleared
    session cookie, P2025-tolerant idempotency. UI: settings danger zone
    (typed-DELETE gate, focus in/out management, field-associated errors)
    + public `/privacy` notice (retention: live purge immediate, backups
    age out ≤30 days) linked from the layout footer and register page.
  - Verification (all green 2026-09-10): `typecheck` + `lint` clean;
    full Vitest 81 files / 637 tests incl. new live-purge test (9 tables
    1→0, repeat DELETE → 401, email freed for re-register), live 429 test
    on the real `rate_limit_hits` bucket, byte-identical 404 bodies for
    foreign vs missing ids (tasks GET, timer start taskId); `pnpm audit`
    clean (2 moderate are pre-existing vitest advisories, ignored with
    rationale); `gitleaks` no leaks (52 commits); full chromium E2E
    matrix 26/26 vs `pnpm build && pnpm start` incl. new
    `e2e/account-deletion.spec.ts` (keyboard-only delete → signed-out
    landing, relogin 401, re-register 201) with axe WCAG 2.1 AA clean on
    `/app/settings` and `/privacy`. (One transient-text assertion in the
    new spec raced the post-delete navigation under parallel load —
    replaced with durable-outcome assertions; the notice itself is
    covered in the component test.)
  - Review checklist sign-off: rate limits verified (6 auth buckets from
    05 + new `account:delete`, live 429s); CSRF/cookies (origin matrix now
    covers all 8 mutations incl. delete; HTTP-only SameSite=Lax cookies,
    Secure on HTTPS — unchanged, tests green); server-side transition
    validation (issues 10/11 suites green, no transition bypass found);
    error-shape leak check (new 404-identity pins; login/forgot-password
    no-enumeration and health no-user-data suites green; only
    ID-addressable routes — tasks `:id`, timer `taskId` — can oracle,
    both pinned; list/aggregate reads return own-rows-only by
    construction); scans clean (above); deletion flow E2E (below);
    30-day backup copy published (`/privacy` + RUNBOOK §4); disclosures
    present (`/privacy`, footer, register link).
  - Code-review (2 axes): renamed wrapper `POST` → `gatedMutation`
    (now serves DELETE too), fixed e2e typo + APP_ORIGIN reuse, added
    delete to the origin matrix, added the live 429 pin, corrected
    RUNBOOK §8 bucket list, softened two overstated privacy sentences.
    Kept with rationale: per-file e2e `tabTo` copies (repo convention),
    axe gates inside the deletion E2E (holds issue 17's all-routes bar
    for the two new/changed views), delete idempotency + email-reuse
    assertions (double-submit safety + purge completeness).
- Deletion drill (acceptance rehearsal): 2026-09-10 23:20–23:45 CEST,
  actor opencode agent (branch `18-security-privacy-review`).
  Procedure per RUNBOOK §5: registered a lived-in account (settings,
  task, timer history) → deleted via the production-build UI journey →
  verified live rows gone (`user/tasks/sessions` counts 0; full 9-table
  purge proven in `account.integration.test.ts`) → confirmed relogin
  401 and email re-registration 201. Backups age out ≤30 days per the
  published copy (`/privacy`); no backup media touched. Result: pass.
- Carry-over (not this issue): Neon dashboard retention re-confirm +
  isolated-restore drill → issue 19; Sentry canary-event review → issue
  06 (both already filed there as pre-beta manual gates).
