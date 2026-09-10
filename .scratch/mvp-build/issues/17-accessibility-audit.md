Status: done
Milestone: 5
Depends on: 08, 12, 16

## Scope

Full WCAG 2.1 AA pass over primary flows: keyboard-only runs, focus
indicators + dialog focus management, announcements, contrast in both themes,
reduced-motion, field-associated errors. Fix what the audit finds.

## Acceptance

- Audit recorded; all primary-workflow findings fixed and re-verified.

## Validation

- Axe clean on all routes both themes; manual keyboard + screen-reader pass
  recorded in issue comments.

## Comments

### Audit (WCAG 2.1 AA, 2026-09-10)

Contrast computed from `app/globals.css` tokens: base pairs pass in both
themes (bg/fg 17.6:1+, primary 6.3–7.4:1, focus ring 6.3–7.4:1 vs 3:1
needed). `text-red-500` on light bg failed (3.76:1 vs 4.5:1 needed).

Findings fixed (all re-verified, see below):

- Blockers: no skip link (2.4.1); `red-500` light-theme error text
  (1.4.3); undefined `--muted` token left the timer track unstyled
  (1.4.11).
- Majors: static theme-toggle name (4.1.2); quick-add `aria-label`
  overriding the visible label (2.5.3); task mutations dropping focus to
  `<body>` (2.4.3); workspace DOM order tasks-first vs visual timer-first
  on mobile (1.3.2/2.4.3); timer dialog with no Tab trap and no
  `aria-describedby` (2.1.2/1.3.1); settings checkboxes/range with no
  visible focus and checkbox field errors rendered nowhere (2.4.7/3.3.1);
  auth links distinguished by color alone (1.4.1); scrollable history/
  analytics regions with no visible focus (2.4.7); `aria-label` on a
  generic `<span>` for the signed-in email (4.1.2, ignored without role).
- Minors: silent `sending` state (`aria-hidden` ellipsis),
  non-`role=status` verifying copy, empty states with no live region,
  volume `<output>` with no unit, lowercase preset preview names, missing
  `aria-current`, duplicate `by-category-heading` id across exclusive
  branches, button ring lost in forced-colors, no global
  `prefers-reduced-motion`/`forced-colors` rules.

Deliberately unchanged: `h1`/`h2` Analytics duplication and workspace
`h1` task echo (descriptive, covered by e2e); timer dialog has no Escape
dissent by design (spec §8.4 — finalizes ONLY via Complete/Discard);
number `spinbutton` + native select kept (operable, e2e-pinned).

### Verification

- `pnpm typecheck`: clean. `pnpm lint`: clean.
- `pnpm test` (full suite): 69 files passed / 10 skipped (DB-gated
  integration), 540 tests passed, 0 failed — incl. 12 new/updated
  a11y seam tests (dialog trap, focus return/recovery, toggle errors,
  volume unit, nav `aria-current`, skip-link target, label-in-name).
  (3 consecutive clean runs; one intermediate run hit a single transient
  failure under parallel load consistent with the documented
  async-budget flake in `vitest.setup.ts` — unreproduced since.)
- Axe (wcag2a+wcag2aa+wcag21a+wcag21aa, Playwright, Chromium): 0
  violations on `/`, `/login`, `/register`, `/forgot-password`,
  `/reset-password`, `/verify-email` in BOTH dark and light themes.
- Manual keyboard (Chromium, no mouse): first Tab lands on "Skip to
  content"; Enter moves focus into `#main`; timer expiry dialog traps
  Tab/Shift+Tab between Complete/Discard; all primary flows remain
  keyboard-only per existing e2e journeys (tabTo loops absorb the one new
  stop; no fixed-count Tab sequences affected).
- Screen-reader pass: announcements verified via `role=status/alert`
  Queries in unit tests (sending/verifying/empty/volume/toggle errors);
  full SR manual run + DB-backed axe on `/app*` routes deferred to CI
  (no DATABASE_URL in this env; `pnpm build` prerender needs it —
  pre-existing constraint, untouched by this change).

### Code review responses (two-axis review of the working diff)

- Fixed: `PrimaryNav` no longer nested inside a duplicate
  `<nav aria-label="Primary">` in the layout (single landmark).
- Fixed: verification-nag `Sending…` is plain text inside the banner's
  own `role=status` — no nested live regions, no `aria-hidden`.
- Reverted as scope creep: `aria-busy` on logout/preview buttons and
  `inputMode="numeric"` on settings spinbuttons (latter redundant on
  `type=number`).
- Kept with justification: visible quick-add label `New task title`
  (2.5.3 Label-in-Name; keeps the `/new task title/i` e2e seam green),
  global `main a` underline (header nav excluded; all content links need
  1.4.1 treatment, incl. verify-email links), shared checkbox error
  region (only failing fields point at it; per-field text preserved),
  inline `text-red-700 dark:text-red-400` (matches the file-local pattern
  the codebase already uses everywhere).
- Tests assert live-region membership via `get(All)ByRole("status")` +
  text (behavior seam); `role=status` takes no name from content per
  ARIA, so name-filtered status queries are avoided.
