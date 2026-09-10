import * as Sentry from "@sentry/nextjs";
import { getSentryInitOptions } from "./lib/sentry";

/**
 * Client-side Sentry init. Same shared options (DSN-gated, PII off,
 * tracing off, shared scrub `beforeSend`) — client errors and breadcrumbs
 * can carry rendered task content, so the scrub hook applies here too.
 */
Sentry.init(
  // Double-cast: intentional — see the typing note in `lib/sentry`.
  getSentryInitOptions() as unknown as Parameters<typeof Sentry.init>[0],
);
