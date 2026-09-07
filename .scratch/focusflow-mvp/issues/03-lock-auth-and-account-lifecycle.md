Status: resolved
Type: grilling
Blocked by: 01

## Question

Lock auth and account-lifecycle rules: should email verification be mandatory before using the app; what exact retention period applies after account deletion (immediate hard-delete vs. grace window + published policy); should completed tasks be retained indefinitely; and is a managed auth provider accepted as preferred (spec §8.1) or must auth be self-built?

Decide verification gating, deletion retention/anonymization, task-retention horizon, and build-vs-buy auth so schema, compliance disclosures, and Milestone 1 auth work are unblocked.

## Answer

- Verification non-blocking: usable immediately with nag; verification sent at registration.
- Deletion: immediate live purge on confirm, 30-day backup expiry per published policy.
- Completed tasks retained until user/account delete; task delete preserves session snapshots.
- Managed auth preferred (vendor deferred to foundation ticket). Spec §8.1 updated.
