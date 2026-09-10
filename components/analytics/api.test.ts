import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsApiError, getSummary, toAnalyticsApiError } from "./api";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

function summaryResponse(overrides: Record<string, unknown> = {}) {
  return {
    period: "7d",
    timezone: "UTC",
    window: {
      from: "2026-09-04T00:00:00.000Z",
      to: "2026-09-10T12:00:00.000Z",
    },
    totals: {
      completedFocusMinutes: 50,
      completedFocusIntervals: 2,
      cancelledFocusIntervals: 0,
      completedTasks: 1,
      completionRate: 1,
      averageCompletedSeconds: 1500,
    },
    daily: [
      { date: "2026-09-10", minutes: 50, intervals: 2 },
    ],
    byTask: [
      {
        taskId: null,
        title: "Write launch notes",
        minutes: 50,
        intervals: 2,
      },
    ],
    byCategory: [{ category: null, minutes: 50, intervals: 2 }],
    ...overrides,
  };
}

/**
 * Seam: typed fetch wrapper over `GET /api/analytics/summary` (issue 15
 * contract). JSON in, `AnalyticsApiError` out — mirrors
 * `components/tasks/api.ts`. Never logs session content.
 */
describe("analytics api client (GET /api/analytics/summary)", () => {
  it("fetches the default 7-day summary", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(summaryResponse(), 200),
    );
    vi.stubGlobal("fetch", fetchMock);
    const summary = await getSummary({});
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analytics/summary?period=7d",
      expect.objectContaining({ method: "GET" }),
    );
    expect(summary.totals.completedFocusMinutes).toBe(50);
    expect(summary.daily).toHaveLength(1);
  });

  it("passes the today period through", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(summaryResponse({ period: "today" }), 200),
    );
    vi.stubGlobal("fetch", fetchMock);
    const summary = await getSummary({ period: "today" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analytics/summary?period=today",
      expect.objectContaining({ method: "GET" }),
    );
    expect(summary.period).toBe("today");
  });

  it("maps failure envelopes onto code + message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Check the highlighted fields and try again.",
            },
          },
          400,
        ),
      ),
    );
    const failure = await getSummary({}).catch((e) => e);
    expect(failure).toBeInstanceOf(AnalyticsApiError);
    expect((failure as AnalyticsApiError).code).toBe("VALIDATION_ERROR");
  });

  it("maps network failure onto a retryable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const failure = await getSummary({}).catch((e) => e);
    expect(failure).toBeInstanceOf(AnalyticsApiError);
    expect((failure as AnalyticsApiError).code).toBe("NETWORK_ERROR");
    expect(toAnalyticsApiError(failure)).toBe(failure);
    expect(toAnalyticsApiError(new Error("boom")).message).toMatch(
      /connection/i,
    );
  });
});
