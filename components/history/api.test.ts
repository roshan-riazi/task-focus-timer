import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HistoryApiError,
  listSessions,
  toHistoryApiError,
} from "./api";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    taskId: null,
    taskTitleSnapshot: "Write launch notes",
    categorySnapshot: "Writing",
    intervalType: "focus",
    status: "completed",
    plannedDurationSeconds: 1500,
    actualDurationSeconds: 1500,
    startedAt: "2026-09-10T07:15:00.000Z",
    expectedEndAt: "2026-09-10T07:40:00.000Z",
    completedAt: "2026-09-10T07:40:00.000Z",
    cancelledAt: null,
    ...overrides,
  };
}

/**
 * Seam: typed fetch wrapper over `GET /api/sessions` (issue 14 contract).
 * JSON envelopes in, `HistoryApiError` out — mirrors
 * `components/tasks/api.ts`. Never logs session content.
 */
describe("history api client (GET /api/sessions)", () => {
  it("lists the default 7-day view with every interval type", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ sessions: [sessionRow()], nextCursor: null }, 200),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await listSessions({});
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sessions?period=7d&type=all",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.sessions).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("passes period, type, and cursor filters through", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ sessions: [], nextCursor: "opaque-cursor" }, 200),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await listSessions({
      period: "today",
      type: "focus",
      cursor: "opaque-cursor",
    });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("period=today");
    expect(url).toContain("type=focus");
    expect(url).toContain(`cursor=${encodeURIComponent("opaque-cursor")}`);
    expect(result.nextCursor).toBe("opaque-cursor");
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
              fields: { cursor: ["This page has expired."] },
            },
          },
          400,
        ),
      ),
    );
    const failure = await listSessions({}).catch((e) => e);
    expect(failure).toBeInstanceOf(HistoryApiError);
    expect((failure as HistoryApiError).code).toBe("VALIDATION_ERROR");
    expect((failure as HistoryApiError).fields).toEqual({
      cursor: ["This page has expired."],
    });
  });

  it("maps network failure onto a retryable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const failure = await listSessions({}).catch((e) => e);
    expect(failure).toBeInstanceOf(HistoryApiError);
    expect((failure as HistoryApiError).code).toBe("NETWORK_ERROR");
    expect(toHistoryApiError(failure)).toBe(failure);
    expect(toHistoryApiError(new Error("boom")).message).toMatch(
      /connection/i,
    );
  });
});
