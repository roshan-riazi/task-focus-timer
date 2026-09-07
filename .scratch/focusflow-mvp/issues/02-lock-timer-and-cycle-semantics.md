Status: resolved
Type: grilling
Blocked by: 01

## Question

Lock timer and focus-cycle semantics that the implementation must encode: should "complete early" count toward the long-break cycle regardless of elapsed time; should a focus interval that expires while the app is closed always reconcile as completed or require confirmation after long absences; should short/long breaks persist in history by default; and do settings changes apply only to newly created intervals (spec §8.5 current rule)?

Decide the exact rules for cycle counting, expiry reconciliation, break persistence, and settings cutover so server-authoritative timer logic, idempotent finalization, and analytics definitions have no ambiguity.

## Answer

- Cycle: only full expiry increments `completed_focus_count`; complete-early = completed with actual minutes for analytics, no cycle increment.
- Expiry-while-closed: auto-complete if back within 60 min past expected end, else confirm dialog with Complete (bounded minutes) / Discard (cancelled, no minutes/cycle); single idempotent finalize.
- Breaks persisted by default, focus/all filters control display.
- Settings apply to new intervals only. Spec §8.4/§8.5/§8.8 updated.
