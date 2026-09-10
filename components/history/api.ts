import type { PublicHistorySession } from "@/lib/sessions/service";
import type { HistoryPeriod, HistoryType } from "@/lib/sessions/validation";

export type { HistoryPeriod, HistoryType };

/**
 * Typed client for the History API (spec §11.3, issue 14 contract).
 * Mirrors `components/tasks/api.ts`: JSON envelopes in, `HistoryApiError`
 * out. Never logs session content — errors carry display strings only.
 *
 * Filters are period-based (`today` | `7d` | `30d`, default `7d`) with a
 * break-visibility toggle (`all` shows persisted breaks, `focus` hides
 * them — spec §8.8). Pagination follows the opaque `nextCursor` token.
 */
export class HistoryApiError extends Error {
  readonly fields: Record<string, string[]>;
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "HistoryApiError";
    this.fields = fields ?? {};
  }
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
}

/** Catch-all for non-envelope throws (network, bugs): retryable message. */
export function toHistoryApiError(error: unknown): HistoryApiError {
  return error instanceof HistoryApiError
    ? error
    : new HistoryApiError(
        "NETWORK_ERROR",
        "Something went wrong. Check your connection and retry.",
        0,
      );
}

async function readEnvelope(res: Response): Promise<ErrorEnvelope> {
  return (await res.json().catch(() => ({}))) as ErrorEnvelope;
}

export interface ListSessionsValues {
  period?: HistoryPeriod;
  type?: HistoryType;
  cursor?: string;
}

export async function listSessions(
  values: ListSessionsValues,
): Promise<{ sessions: PublicHistorySession[]; nextCursor: string | null }> {
  const query = new URLSearchParams({
    period: values.period ?? "7d",
    type: values.type ?? "all",
  });
  if (values.cursor) query.set("cursor", values.cursor);
  let res: Response;
  try {
    res = await fetch(`/api/sessions?${query.toString()}`, { method: "GET" });
  } catch {
    throw new HistoryApiError(
      "NETWORK_ERROR",
      "Something went wrong. Check your connection and retry.",
      0,
    );
  }
  if (res.ok) {
    return (await res.json()) as {
      sessions: PublicHistorySession[];
      nextCursor: string | null;
    };
  }
  const body = await readEnvelope(res);
  throw new HistoryApiError(
    body.error?.code ?? "REQUEST_FAILED",
    body.error?.message ?? "Something went wrong.",
    res.status,
    body.error?.fields,
  );
}
