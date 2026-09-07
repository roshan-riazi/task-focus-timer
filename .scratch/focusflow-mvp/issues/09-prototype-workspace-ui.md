Status: resolved
Type: prototype

## Question

Prototype the FocusFlow workspace UI as a cheap static mock both sides can
react to: desktop task-list-left + timer-main layout and mobile timer-first
stack (§9.3), timer controls (start/pause/resume/complete-early/cancel/
skip-break), expiry-confirm dialog (>60 min), history + analytics (SVG bars +
table equivalents) + empty states, verification nag, settings cutover note.

Constrain to locked scope: minimal FocusFlow identity, WCAG 2.1 AA structure,
native SVG (no chart lib), English-only copy from the spec. Styling assumption
for production: Tailwind + shadcn/ui (to be locked in Milestone 1 issues).
This mock is throwaway (vanilla CSS) — it validates understanding, not implementation.

Asset: `../prototype/workspace.html` (entry; open directly in a browser;
narrow to ~360px for the mobile stack) + `history.html`, `analytics.html`,
`settings.html`. Rev 2: focus page holds tasks + timer only; history/analytics/
settings moved to their own pages per §9 IA; light + dark theme toggle
(system default, remembered per browser). Rev 3: dark theme is the default
(light on toggle); timer readout sits inside an SVG progress ring
(`role=progressbar` with aria-valuenow) that fills as the interval elapses.

## Answer

Approved rev 3 (2026-09-07): focus page holds tasks + timer only (history/
analytics/settings on own pages per §9 IA); dark theme default with light
toggle (remembered); timer readout inside an SVG progress ring reflecting
elapsed share. Reflected in PRODUCT_SPEC (§8.4 display, §9.3 theme),
SYSTEM_DESIGN (§§2/4), ADR-0001 (styling locked: Tailwind + shadcn/ui).
