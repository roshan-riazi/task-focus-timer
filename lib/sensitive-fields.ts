/**
 * Single source of truth for the privacy invariant behind PRODUCT_SPEC §12.2
 * and SYSTEM_DESIGN §8: user-authored task content (titles, notes, category,
 * and session snapshots derived from them) plus secrets must never reach
 * structured logs or error reports. Values under these keys are arbitrary
 * user input, so no pattern can identify them — the key is the signal, and
 * both `lib/log` (pino redaction) and `lib/errors` (payload scrubbing)
 * derive from this list so they cannot drift apart.
 */
export const REDACTED = "[Redacted]";

export const SENSITIVE_FIELD_NAMES: readonly string[] = [
  // User-authored task content (spec §10.3 fields + session snapshots).
  "title",
  "notes",
  "category",
  "tasktitle",
  "tasknotes",
  "taskcategory",
  "task_title_snapshot",
  "category_snapshot",
  // Secrets / credentials.
  "database_url",
  "auth_secret",
  "email_api_key",
  "error_dsn",
  "password",
  "authorization",
  "cookie",
  "cookies",
  "set-cookie",
];

// Pino redaction paths are case-sensitive while `scrubPayload` lowercases
// keys first, so camelCase/UPPER variants live here once for both consumers.
export const SENSITIVE_FIELD_NAME_VARIANTS: readonly string[] = [
  "taskTitle",
  "taskNotes",
  "taskCategory",
  "DATABASE_URL",
  "AUTH_SECRET",
  "EMAIL_API_KEY",
  "ERROR_DSN",
];
