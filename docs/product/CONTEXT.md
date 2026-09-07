# FocusFlow — Context

Single-context product domain: personal productivity for professionals/knowledge workers.

Core loop: create or select a task → focus for a defined interval → understand where focused time went.

Authoritative scope: `PRODUCT_SPEC.md` (same directory) defines product scope and acceptance criteria unless superseded by an accepted ADR or explicitly approved product change.

Wayfinding map: `.scratch/focusflow-mvp/map.md` (destination, decisions-so-far, fog, out-of-scope) with decision tickets under `.scratch/focusflow-mvp/issues/`.

Key boundaries (MVP):

- Included: lightweight personal task list, Pomodoro timer with server-authoritative timestamps, short/long breaks, individual descriptive analytics, responsive web UI.
- Excluded: collaboration/surveillance, billing, native apps, offline sync, WebSocket realtime, AI/predictive, custom dashboards (see PRODUCT_SPEC §5.2 and map Out-of-scope).

Glossary seed (to be refined via domain-modeling): task, focus interval, break (short/long), session history, focus-cycle count, completed focus minutes, completion rate, timezone-aware reporting day.
