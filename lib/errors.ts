import { getLogger } from "./log";
import { REDACTED, SENSITIVE_FIELD_NAMES } from "./sensitive-fields";

export { REDACTED };

/**
 * Values under these keys may carry user-authored task content or secrets
 * (see `lib/sensitive-fields`); they are replaced wholesale. Compared
 * case-insensitively so `taskTitle` and `TASKTITLE` scrub alike.
 */
const SENSITIVE_KEYS = new Set(SENSITIVE_FIELD_NAMES);

/** Request bodies may carry task content — never forwarded to error reports. */
const DROPPED_EVENT_KEYS = new Set(["data", "cookies", "user"]);

const CONNECTION_STRING = /postgres(?:ql)?:\/\/[^\s"'`]+/gi;
const BEARER_TOKEN = /Bearer\s+[A-Za-z0-9\-._~+/=]+/g;

function scrubString(value: string): string {
  return value
    .replace(CONNECTION_STRING, REDACTED)
    .replace(BEARER_TOKEN, `Bearer ${REDACTED}`);
}

/** Deep-scrub any JSON-ish payload: sensitive keys replaced, secrets in strings removed. */
export function scrubPayload<T>(value: T): T {
  if (typeof value === "string") return scrubString(value) as T;
  if (Array.isArray(value)) return value.map(scrubPayload) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = scrubPayload(entry);
    }
    return out as T;
  }
  return value;
}

export interface SentryLikeEvent {
  request?: { data?: unknown; cookies?: unknown; [key: string]: unknown };
  user?: unknown;
  extra?: unknown;
  exception?: unknown;
  breadcrumbs?: unknown;
  [key: string]: unknown;
}

/**
 * Sentry `beforeSend` hook: drops request bodies/cookies/user objects
 * (they may contain task content) and deep-scrubs the rest. Wire as
 * `beforeSend: sentryBeforeSend` in the Sentry init (see RUNBOOK §6).
 *
 * Contract: never interpolate task titles/notes into thrown error messages —
 * messages are the one channel key-based scrubbing cannot attribute, so only
 * secret *patterns* are removed from free-form strings. Enforced by review.
 */
export function sentryBeforeSend(
  event: SentryLikeEvent | null,
): SentryLikeEvent | null {
  if (event === null) return null;
  const scrubbed = scrubPayload(event) as SentryLikeEvent;
  if (scrubbed.request) {
    for (const key of DROPPED_EVENT_KEYS) {
      if (key in scrubbed.request) {
        (scrubbed.request as Record<string, unknown>)[key] = REDACTED;
      }
    }
  }
  if ("user" in scrubbed) scrubbed.user = REDACTED;
  return scrubbed;
}

export interface PublicError {
  status: number;
  body: { error: { code: string; message: string } };
}

/** Public error envelope: stable code + generic message, never internals. */
export function toPublicError(_cause: unknown): PublicError {
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
  };
}

/**
 * Server-side error capture: logs a stable, content-free record and forwards
 * a scrubbed event to Sentry when the SDK is wired. Never logs the raw error
 * message (it may embed driver internals); never throws.
 */
export async function reportError(
  cause: unknown,
  opts: { requestId?: string } = {},
): Promise<void> {
  try {
    const name =
      cause instanceof Error ? cause.name : typeof cause === "object" ? "Error" : "Unknown";
    getLogger(opts.requestId).error(
      { errName: scrubString(String(name)) },
      "unhandled error",
    );
    const sentry = (globalThis as Record<string, unknown>).Sentry as
      | { captureException?: (e: unknown) => void }
      | undefined;
    if (typeof sentry?.captureException === "function") {
      sentry.captureException(
        sentryBeforeSend({ exception: { values: [{ type: name }] } }),
      );
    }
  } catch {
    // Reporting must never break the request path.
  }
}
