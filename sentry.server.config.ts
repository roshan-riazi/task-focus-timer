import * as Sentry from "@sentry/nextjs";
import { getSentryInitOptions } from "./lib/sentry";

/**
 * Server-side Sentry init (Node.js runtime). Options come from
 * `lib/sentry` so server/edge/client cannot drift: DSN-gated
 * (`ERROR_DSN`), `sendDefaultPii: false`, tracing off, and `beforeSend`
 * is the shared scrub hook from `lib/errors` (derived from
 * `lib/sensitive-fields`). With no DSN this initializes disabled (no-op).
 */
Sentry.init(
  // Double-cast: intentional — see the typing note in `lib/sentry`.
  getSentryInitOptions() as unknown as Parameters<typeof Sentry.init>[0],
);
