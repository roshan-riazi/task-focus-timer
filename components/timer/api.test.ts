import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TimerApiError,
  cancelTimer,
  completeTimer,
  getCurrentTimer,
  pauseTimer,
  resumeTimer,
  skipBreakTimer,
  startTimer,
  toTimerApiError,
} from "./api";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

function sampleSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    taskId: null,
    taskTitleSnapshot: null,
    categorySnapshot: null,
    intervalType: "focus",
    status: "running",
    plannedDurationSeconds: 1500,
    actualDurationSeconds: null,
    startedAt: "2026-09-10T12:00:00.000Z",
    expectedEndAt: "2026-09-10T12:25:00.000Z",
    pausedAt: null,
    accumulatedPauseSeconds: 0,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2026-09-10T12:00:00.000Z",
    updatedAt: "2026-09-10T12:00:00.000Z",
    ...overrides,
  };
}

function sampleCurrent(overrides: Record<string, unknown> = {}) {
  return {
    session: sampleSession(),
    reconciled: null,
    pendingConfirmation: null,
    autoStarted: null,
    cycle: { completedFocusCount: 0, intervalsBeforeLongBreak: 4 },
    next: null,
    ...overrides,
  };
}

describe("timer api client", () => {
  it("fetches the current timer state (reconcile entry point)", async () => {
    const body = sampleCurrent();
    const fetchMock = vi.fn(async () => jsonResponse(body, 200));
    vi.stubGlobal("fetch", fetchMock);
    const result = await getCurrentTimer();
    expect(fetchMock).toHaveBeenCalledWith("/api/timer/current", {
      method: "GET",
    });
    expect(result.session?.id).toBe(sampleSession().id);
  });

  it("starts a focus interval for the selected task", async () => {
    const session = sampleSession();
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        jsonResponse({ session }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await startTimer({
      intervalType: "focus",
      taskId: "11111111-1111-4111-8111-111111111111",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/timer/start",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({
      intervalType: "focus",
      taskId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.id).toBe(session.id);
  });

  it("starts unassigned when no task is selected", async () => {
    const session = sampleSession({ taskId: null });
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        jsonResponse({ session }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);
    await startTimer({ intervalType: "focus" });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({
      intervalType: "focus",
    });
  });

  it("pauses and resumes through the mutation endpoints", async () => {
    const paused = sampleSession({ status: "paused" });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return jsonResponse({ session: paused }, 200);
      }),
    );
    await pauseTimer();
    await resumeTimer();
    expect(calls).toEqual(["/api/timer/pause", "/api/timer/resume"]);
  });

  it("sends an Idempotency-Key on finalize operations", async () => {
    const finalized = sampleSession({ status: "completed" });
    const seen: Record<string, string | null> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seen[url] = headers.get("Idempotency-Key");
        return jsonResponse(
          {
            session: finalized,
            autoStarted: null,
            cycle: { completedFocusCount: 0, intervalsBeforeLongBreak: 4 },
            next: { intervalType: "short_break" },
          },
          200,
        );
      }),
    );
    await completeTimer("key-1");
    await cancelTimer("key-2");
    await skipBreakTimer("key-3");
    expect(seen["/api/timer/complete"]).toBe("key-1");
    expect(seen["/api/timer/cancel"]).toBe("key-2");
    expect(seen["/api/timer/skip-break"]).toBe("key-3");
  });

  it("surfaces conflict codes (ACTIVE_TIMER_EXISTS / ALREADY_FINALIZED)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "ACTIVE_TIMER_EXISTS",
              message: "Finish or cancel the current interval first.",
            },
          },
          409,
        ),
      ),
    );
    const error = await startTimer({ intervalType: "focus" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TimerApiError);
    expect((error as TimerApiError).code).toBe("ACTIVE_TIMER_EXISTS");
    expect((error as TimerApiError).status).toBe(409);
  });

  it("maps network failures to a retryable NETWORK_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const error = await getCurrentTimer().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimerApiError);
    expect((error as TimerApiError).code).toBe("NETWORK_ERROR");
    expect(toTimerApiError(new Error("boom")).code).toBe("NETWORK_ERROR");
  });
});
