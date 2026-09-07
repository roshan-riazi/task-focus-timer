Status: resolved
Type: grilling
Blocked by: 01

## Question

Lock analytics and presentation scope: does the seven-day report mean a rolling 7-day window or the current calendar week; is localization required for MVP and if so which languages; what is the final product name and visual identity (FocusFlow vs. rename); and are the daily bar chart + ranked task/category lists with textual equivalents sufficient for MVP?

Decide period definitions, i18n scope, naming/identity, and chart sufficiency so timezone-aware aggregation, accessibility equivalents, and empty-state copy have no open product questions.

## Answer

- Seven-day = rolling 7 local days incl. today; Today = local calendar day.
- English-only MVP, i18n-ready strings.
- FocusFlow locked with minimal identity.
- Bar + ranked lists + table equivalents sufficient. Spec §8.9 updated.
