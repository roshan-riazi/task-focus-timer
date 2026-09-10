import * as Sentry from "@sentry/nextjs";

/**
 * Next.js server instrumentation (issue 06). Registers the Sentry
 * server/edge configs per runtime and forwards captured request errors
 * through the SDK — which applies the shared scrub `beforeSend`
 * (`lib/errors`, via `lib/sentry` options) before anything leaves the
 * process. With no `ERROR_DSN` the SDK stays disabled (no-op).
 *
 * Deliberately no `withSentryConfig` wrapper in `next.config.ts` for the
 * MVP: source-map upload and tunneling need `SENTRY_ORG`/`SENTRY_PROJECT`/
 * `SENTRY_AUTH_TOKEN`, which would add secrets and CI steps before beta.
 * Error capture works without it; revisit post-beta if readable production
 * stack traces justify the upload pipeline.
 *
 * Contract note: unlike `reportError` (type-only events), `onRequestError`
 * forwards full request errors through the SDK, so it relies on the shared
 * `beforeSend` scrub for protection. Key-attributed content (titles, notes,
 * secrets, cookies) is scrubbed there; free-form error *messages* can only
 * be pattern-scrubbed — so never interpolate task content into thrown error
 * messages (enforced by review). The pre-beta manual Sentry event review
 * (RUNBOOK §7) covers this path.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
