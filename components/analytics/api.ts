import type { AnalyticsSummary } from "@/lib/analytics/service";
import type { AnalyticsPeriod } from "@/lib/analytics/validation";

export type { AnalyticsPeriod };

/**
 * Typed client for the Analytics API (spec §11.3, issue 15 contract).
 * Mirrors `components/tasks/api.ts`: JSON envelopes in,
 * `AnalyticsApiError` out. Never logs session content — errors carry
 * display strings only.
 *
 * Periods are rolling local days (`today` | `7d`, default `7d`); `30d` is
 * history-only and the API rejects it, so this client never sends it.
 */
export class AnalyticsApiError extends Error {
  readonly fields: Record<string, string[]>;
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AnalyticsApiError";
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
export function toAnalyticsApiError(error: unknown): AnalyticsApiError {
  return error instanceof AnalyticsApiError
    ? error
    : new AnalyticsApiError(
        "NETWORK_ERROR",
        "Something went wrong. Check your connection and retry.",
        0,
      );
}

async function readEnvelope(res: Response): Promise<ErrorEnvelope> {
  return (await res.json().catch(() => ({}))) as ErrorEnvelope;
}

export interface GetSummaryValues {
  period?: AnalyticsPeriod;
}

export async function getSummary(
  values: GetSummaryValues,
): Promise<AnalyticsSummary> {
  const query = new URLSearchParams({ period: values.period ?? "7d" });
  let res: Response;
  try {
    res = await fetch(`/api/analytics/summary?${query.toString()}`, {
      method: "GET",
    });
  } catch {
    throw new AnalyticsApiError(
      "NETWORK_ERROR",
      "Something went wrong. Check your connection and retry.",
      0,
    );
  }
  if (res.ok) return (await res.json()) as AnalyticsSummary;
  const body = await readEnvelope(res);
  throw new AnalyticsApiError(
    body.error?.code ?? "REQUEST_FAILED",
    body.error?.message ?? "Something went wrong.",
    res.status,
    body.error?.fields,
  );
}
