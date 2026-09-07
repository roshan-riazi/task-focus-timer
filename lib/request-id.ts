import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

const MAX_REQUEST_ID_LENGTH = 128;

/**
 * Preserve an incoming request ID, or generate one when absent/blank.
 * Incoming values are trimmed, stripped of CR/LF (header-safety), and
 * capped so a malicious or broken client cannot blow up log lines.
 */
export function ensureRequestId(incoming: string | null | undefined): string {
  if (typeof incoming === "string") {
    const clean = incoming.replace(/[\r\n]/g, "").trim();
    if (clean.length > 0) {
      return clean.slice(0, MAX_REQUEST_ID_LENGTH);
    }
  }
  return randomUUID();
}
