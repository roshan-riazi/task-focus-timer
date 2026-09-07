# MVP build — spec pointer (do not duplicate)

Authoritative sources (read these, not copies):

- Product scope + acceptance: `docs/product/PRODUCT_SPEC.md`
- Domain language: `docs/product/CONTEXT.md`
- Architecture: `docs/architecture/SYSTEM_DESIGN.md` + `docs/adr/`
- Quality: `docs/testing/TEST_STRATEGY.md`
- Operations: `docs/operations/RUNBOOK.md`
- UI understanding: `.scratch/focusflow-mvp/prototype/*.html` (throwaway mock)
- Decisions: `.scratch/focusflow-mvp/map.md` Decisions-so-far + ticket Answers

Conventions for every issue in `issues/`:

- `Status:` triage line near the top (`open` → in progress → done).
- `Depends on:` lists issue numbers that must land first.
- `## Validation` maps the work to TEST_STRATEGY suites; CI gates stay green.
- One branch per issue; merge only with CI green and Validation satisfied.
- If an issue proves bigger than one session, split it (a/b suffix, renumber
  dependants) rather than half-landing it.
- No product-analytics telemetry, no task content in logs/errors — ever.
