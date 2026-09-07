import pino, { type DestinationStream, type Logger } from "pino";
import { REDACTED, SENSITIVE_FIELD_NAMES, SENSITIVE_FIELD_NAME_VARIANTS } from "./sensitive-fields";

export interface LoggerBindings {
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Pino redaction paths derived from {@link SENSITIVE_FIELD_NAMES}: each field
 * is redacted at the top level, one level deep (`task.title`), and under any
 * parent (`*.title`). Contract: never interpolate task content into the log
 * message string itself — pass it as a field so redaction can attribute it.
 */
const REDACT_PATHS = [...SENSITIVE_FIELD_NAMES, ...SENSITIVE_FIELD_NAME_VARIANTS].flatMap(
  (field) => [field, `*.${field}`],
);

function defaultLevel(): string {
  const level = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return ["fatal", "error", "warn", "info", "debug", "trace"].includes(level)
    ? level
    : "info";
}

export function createLogger(
  bindings: LoggerBindings = {},
  destination?: DestinationStream,
): Logger {
  const { requestId, ...rest } = bindings;
  return pino(
    {
      level: defaultLevel(),
      base: requestId ? { requestId } : undefined,
      redact: { paths: REDACT_PATHS, censor: REDACTED },
    },
    destination,
  ).child(rest);
}

let defaultLogger: Logger | null = null;

/** Shared process logger; prefer {@link createLogger} with a request ID per request. */
export function getLogger(requestId?: string): Logger {
  if (requestId) return createLogger({ requestId });
  if (!defaultLogger) defaultLogger = createLogger({});
  return defaultLogger;
}
