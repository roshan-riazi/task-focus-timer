import { sentryBeforeSend, type SentryLikeEvent } from "./errors";

/**
 * Sentry wiring seam for issue 06 (scrubbed error monitoring).
 *
 * Single source for the SDK init options so the server, edge, and client
 * entrypoints cannot drift apart: every entrypoint calls
 * `Sentry.init(getSentryInitOptions())`. The scrub contract lives in
 * `lib/errors.sentryBeforeSend` (derived from `lib/sensitive-fields`); this
 * module only selects the DSN and locks the privacy-relevant flags.
 *
 * Privacy: `sendDefaultPii: false`, `tracesSampleRate: 0` (error monitoring
 * only on the free-tier MVP — no tracing, no PII), and `beforeSend` is always
 * the shared scrub hook. With no `ERROR_DSN` the SDK initializes disabled
 * (no-op) so local/dev/test never emit events.
 *
 * Typing note: `beforeSend` here is typed against the SDK-free
 * `SentryLikeEvent` (not the SDK's `ErrorEvent`) so this module — and its
 * unit tests — stay free of SDK side effects. The three thin entrypoints
 * (`sentry.server.config`, `sentry.edge.config`, `instrumentation-client`)
 * pass these options with `as unknown as Parameters<typeof Sentry.init>[0]`;
 * the intentional gap is covered at runtime by the canary-scrub tests.
 */
/** Reads `ERROR_DSN` (trimmed); `undefined` when absent or blank = SDK disabled. */
export function getSentryDsn(): string | undefined {
  const raw = process.env.ERROR_DSN?.trim();
  return raw ? raw : undefined;
}

/** True only when a non-blank `ERROR_DSN` is configured. */
export function isSentryEnabled(): boolean {
  return getSentryDsn() !== undefined;
}

/** SDK init options shared by the server, edge, and client entrypoints. */
export interface SentryInitOptions {
  dsn: string | undefined;
  beforeSend: (
    event: SentryLikeEvent | null,
  ) => SentryLikeEvent | null;
  sendDefaultPii: false;
  tracesSampleRate: number;
}

/** Builds the shared init options: DSN-gated, PII off, tracing off, shared scrub hook. */
export function getSentryInitOptions(): SentryInitOptions {
  return {
    dsn: getSentryDsn(),
    beforeSend: sentryBeforeSend,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  };
}
