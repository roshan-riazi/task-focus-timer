import type {
  CurrentResult,
  FinalizeResult,
  IntervalType,
  PublicSession,
} from "@/lib/timer/service";

/**
 * Typed client for the Timer API (spec §11.2, issues 10/11 contract).
 * Mirrors `components/tasks/api.ts`: JSON envelopes in, `TimerApiError`
 * out. Never logs session content — errors carry display strings only.
 *
 * Finalize calls (complete/cancel/skip-break) send an `Idempotency-Key`
 * header (SYSTEM_DESIGN §6): callers pass an explicit key per user intent
 * so a retry replays instead of conflicting; when omitted a fresh UUID is
 * minted for the single attempt.
 */
export class TimerApiError extends Error {
  readonly fields: Record<string, string[]>;
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "TimerApiError";
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
export function toTimerApiError(error: unknown): TimerApiError {
  return error instanceof TimerApiError
    ? error
    : new TimerApiError(
        "NETWORK_ERROR",
        "Something went wrong. Check your connection and retry.",
        0,
      );
}

async function readEnvelope(res: Response): Promise<ErrorEnvelope> {
  return (await res.json().catch(() => ({}))) as ErrorEnvelope;
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new TimerApiError(
      "NETWORK_ERROR",
      "Something went wrong. Check your connection and retry.",
      0,
    );
  }
  if (res.ok) return (await res.json()) as T;
  const body = await readEnvelope(res);
  throw new TimerApiError(
    body.error?.code ?? "REQUEST_FAILED",
    body.error?.message ?? "Something went wrong.",
    res.status,
    body.error?.fields,
  );
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function finalizeInit(key?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": key ?? crypto.randomUUID(),
    },
  };
}

export async function getCurrentTimer(): Promise<CurrentResult> {
  return request<CurrentResult>("/api/timer/current", { method: "GET" });
}

export interface StartTimerValues {
  intervalType: IntervalType;
  taskId?: string;
}

export async function startTimer(
  values: StartTimerValues,
): Promise<PublicSession> {
  const { session } = await request<{ session: PublicSession }>(
    "/api/timer/start",
    jsonInit("POST", values.taskId ? values : { intervalType: values.intervalType }),
  );
  return session;
}

export async function pauseTimer(): Promise<PublicSession> {
  const { session } = await request<{ session: PublicSession }>(
    "/api/timer/pause",
    jsonInit("POST"),
  );
  return session;
}

export async function resumeTimer(): Promise<PublicSession> {
  const { session } = await request<{ session: PublicSession }>(
    "/api/timer/resume",
    jsonInit("POST"),
  );
  return session;
}

export async function completeTimer(key?: string): Promise<FinalizeResult> {
  return request<FinalizeResult>("/api/timer/complete", finalizeInit(key));
}

export async function cancelTimer(key?: string): Promise<FinalizeResult> {
  return request<FinalizeResult>("/api/timer/cancel", finalizeInit(key));
}

export async function skipBreakTimer(key?: string): Promise<FinalizeResult> {
  return request<FinalizeResult>("/api/timer/skip-break", finalizeInit(key));
}
