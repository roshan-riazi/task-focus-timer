import * as Sentry from "@sentry/nextjs";
import { getSentryInitOptions } from "./lib/sentry";

/**
 * Edge-runtime Sentry init (middleware/edge routes). Same shared options as
 * the server entrypoint — see `sentry.server.config.ts`. Kept as a separate
 * file because Next/Sentry load server and edge configs independently.
 */
Sentry.init(
  // Double-cast: intentional — see the typing note in `lib/sentry`.
  getSentryInitOptions() as unknown as Parameters<typeof Sentry.init>[0],
);
