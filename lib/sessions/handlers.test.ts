import { describe, expect, it, vi } from "vitest";
import type { AppSession } from "../auth/session";
import { HistoryServiceError, type HistoryService } from "./service";
import { createListSessionsHandler, type HistoryHandlerDeps } from "./handlers";

/**
 * Seam 3 (unit, hermetic): HTTP status codes, envelopes, and session
 * scoping at the history-route boundary. The handler runs against a stub
 * service and a stub session reader — no Prisma, no Next.js. Live-DB
 * coverage of the same handler lands in
 * app/api/sessions/sessions.integration.test.ts (CI + local Postgres).
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

function stubService(overrides: Partial<HistoryService> = {}): HistoryService {
  const notImplemented = async (): Promise<never> => {
    throw new Error("not implemented in stub");
  };
  return {
    list: notImplemented,
    ...overrides,
  } as HistoryService;
}

function deps(overrides: Partial<HistoryHandlerDeps> = {}): HistoryHandlerDeps {
  return {
    getService: async () => stubService(),
    getSession: async () => appSession,
    ...overrides,
  };
}

function getRequest(path: string) {
  return new Request(`${APP_URL}${path}`, { method: "GET" });
}

function sampleSession() {
  return {
    id: crypto.randomUUID(),
    taskId: null,
    taskTitleSnapshot: null,
    categorySnapshot: null,
    intervalType: "focus" as const,
    status: "completed" as const,
    plannedDurationSeconds: 1500,
    actualDurationSeconds: 1500,
    startedAt: "2026-09-10T10:00:00.000Z",
    expectedEndAt: "2026-09-10T10:25:00.000Z",
    completedAt: "2026-09-10T10:25:00.000Z",
    cancelledAt: null,
  };
}

describe("GET /api/sessions", () => {
  it("returns 401 when signed out", async () => {
    const signedOut = deps({ getSession: async () => null });
    expect(
      await createListSessionsHandler(signedOut)(getRequest("/api/sessions")),
    ).toMatchObject({ status: 401 });
  });

  it("lists with query passthrough and scopes to the session user", async () => {
    const session = sampleSession();
    const list = vi.fn(async () => ({ sessions: [session], nextCursor: null }));
    const handler = createListSessionsHandler(
      deps({ getService: async () => stubService({ list }) }),
    );
    const res = await handler(
      getRequest("/api/sessions?period=today&type=focus&limit=5&cursor=abc"),
    );
    expect(res.status).toBe(200);
    // Identity derives from the session, never from client input
    // (spec §11.5): there is no userId to forge — the handler passes the
    // session id positionally.
    expect(list).toHaveBeenCalledWith("user-1", {
      period: "today",
      type: "focus",
      limit: "5",
      cursor: "abc",
    });
    expect(await res.json()).toEqual({ sessions: [session], nextCursor: null });
  });

  it("forwards the next-page cursor untouched", async () => {
    const list = vi.fn(async () => ({
      sessions: [sampleSession()],
      nextCursor: "opaque-token",
    }));
    const handler = createListSessionsHandler(
      deps({ getService: async () => stubService({ list }) }),
    );
    const res = await handler(getRequest("/api/sessions"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ nextCursor: "opaque-token" });
  });

  it("maps service validation failures to the 400 field envelope", async () => {
    const handler = createListSessionsHandler(
      deps({
        getService: async () =>
          stubService({
            list: async () => {
              throw new HistoryServiceError("VALIDATION_ERROR", "Bad.", {
                cursor: ["This page has expired. Start from the first page."],
              });
            },
          }),
      }),
    );
    const res = await handler(getRequest("/api/sessions?cursor=bogus"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; fields: Record<string, string[]> };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.cursor).toHaveLength(1);
  });

  it("maps unexpected failures to a leak-free 500", async () => {
    const handler = createListSessionsHandler(
      deps({
        getService: async () => {
          throw new Error("connect ECONNREFUSED postgres://secret@db:5432");
        },
      }),
    );
    const res = await handler(getRequest("/api/sessions"));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("INTERNAL_ERROR");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("postgres://");
  });
});
