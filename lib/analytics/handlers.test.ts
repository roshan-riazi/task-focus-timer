import { describe, expect, it, vi } from "vitest";
import type { AppSession } from "../auth/session";
import { AnalyticsServiceError, type AnalyticsService } from "./service";
import { createAnalyticsSummaryHandler, type AnalyticsHandlerDeps } from "./handlers";

/**
 * Seam 3 (unit, hermetic): HTTP status codes, envelopes, and session
 * scoping at the analytics-route boundary. The handler runs against a
 * stub service and a stub session reader — no Prisma, no Next.js.
 * Live-DB coverage of the same handler lands in
 * app/api/analytics/summary/analytics.integration.test.ts (CI + local
 * Postgres).
 */
const APP_URL = "http://localhost:3000";

const appSession: AppSession = {
  user: {
    id: "user-1",
    email: "alice@example.com",
    emailVerified: null,
    timezone: "UTC",
  },
  expires: new Date("2026-10-09T12:00:00.000Z").toISOString(),
};

function stubService(overrides: Partial<AnalyticsService> = {}): AnalyticsService {
  const notImplemented = async (): Promise<never> => {
    throw new Error("not implemented in stub");
  };
  return {
    summary: notImplemented,
    ...overrides,
  } as AnalyticsService;
}

function deps(overrides: Partial<AnalyticsHandlerDeps> = {}): AnalyticsHandlerDeps {
  return {
    getService: async () => stubService(),
    getSession: async () => appSession,
    ...overrides,
  };
}

function getRequest(path: string) {
  return new Request(`${APP_URL}${path}`, { method: "GET" });
}

function sampleSummary() {
  return {
    period: "7d" as const,
    timezone: "UTC",
    window: { from: "2026-09-04T00:00:00.000Z", to: "2026-09-10T12:00:00.000Z" },
    totals: {
      completedFocusMinutes: 25,
      completedFocusIntervals: 1,
      cancelledFocusIntervals: 0,
      completedTasks: 0,
      completionRate: 1,
      averageCompletedSeconds: 1500,
    },
    daily: [{ date: "2026-09-10", minutes: 25, intervals: 1 }],
    byTask: [],
    byCategory: [],
  };
}

describe("GET /api/analytics/summary", () => {
  it("returns 401 when signed out", async () => {
    const signedOut = deps({ getSession: async () => null });
    expect(
      await createAnalyticsSummaryHandler(signedOut)(getRequest("/api/analytics/summary")),
    ).toMatchObject({ status: 401 });
  });

  it("summarizes with query passthrough and scopes to the session user", async () => {
    const summary = sampleSummary();
    const summaryFn = vi.fn(async () => summary);
    const handler = createAnalyticsSummaryHandler(
      deps({ getService: async () => stubService({ summary: summaryFn }) }),
    );
    const res = await handler(getRequest("/api/analytics/summary?period=today"));
    expect(res.status).toBe(200);
    // Identity derives from the session, never from client input
    // (spec §11.5): there is no userId to forge — the handler passes the
    // session id positionally.
    expect(summaryFn).toHaveBeenCalledWith("user-1", { period: "today" });
    expect(await res.json()).toEqual(summary);
  });

  it("defaults to the rolling week when no period is given", async () => {
    const summaryFn = vi.fn(async () => sampleSummary());
    const handler = createAnalyticsSummaryHandler(
      deps({ getService: async () => stubService({ summary: summaryFn }) }),
    );
    const res = await handler(getRequest("/api/analytics/summary"));
    expect(res.status).toBe(200);
    expect(summaryFn).toHaveBeenCalledWith("user-1", {});
  });

  it("maps service validation failures to the 400 field envelope", async () => {
    const handler = createAnalyticsSummaryHandler(
      deps({
        getService: async () =>
          stubService({
            summary: async () => {
              throw new AnalyticsServiceError("VALIDATION_ERROR", "Bad.", {
                period: ["Invalid option."],
              });
            },
          }),
      }),
    );
    const res = await handler(getRequest("/api/analytics/summary?period=30d"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; fields: Record<string, string[]> };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.period).toHaveLength(1);
  });

  it("maps unexpected failures to a leak-free 500", async () => {
    const handler = createAnalyticsSummaryHandler(
      deps({
        getService: async () => {
          throw new Error("connect ECONNREFUSED postgres://secret@db:5432");
        },
      }),
    );
    const res = await handler(getRequest("/api/analytics/summary"));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("INTERNAL_ERROR");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("postgres://");
  });
});
