import { describe, expect, it, vi } from "vitest";
import type { AppSession } from "../auth/session";
import {
  TimerServiceError,
  type CurrentResult,
  type FinalizeResult,
  type TimerService,
} from "./service";
import {
  createCancelTimerHandler,
  createCompleteTimerHandler,
  createCurrentTimerHandler,
  createPauseTimerHandler,
  createResumeTimerHandler,
  createSkipBreakTimerHandler,
  createStartTimerHandler,
  type TimerHandlerDeps,
} from "./handlers";

/**
 * Seam 3 (unit, hermetic): HTTP status codes, envelopes, session scoping,
 * and `Idempotency-Key` plumbing at the timer-route boundary. Every handler
 * runs against a stub service and a stub session reader — no Prisma, no
 * Next.js. Live-DB coverage of the same handlers lands in
 * app/api/timer/timer.integration.test.ts (CI + local Postgres).
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

function sampleSession() {
  return {
    id: crypto.randomUUID(),
    taskId: null,
    taskTitleSnapshot: null,
    categorySnapshot: null,
    intervalType: "focus" as const,
    status: "running" as const,
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
  };
}

function sampleCycle() {
  return { completedFocusCount: 0, intervalsBeforeLongBreak: 4 };
}

function sampleCurrent(
  overrides: Partial<CurrentResult> = {},
): CurrentResult {
  return {
    session: sampleSession(),
    reconciled: null,
    pendingConfirmation: null,
    autoStarted: null,
    cycle: sampleCycle(),
    next: null,
    ...overrides,
  };
}

function sampleFinalize(
  overrides: Partial<FinalizeResult> = {},
): FinalizeResult {
  return {
    session: { ...sampleSession(), status: "completed" },
    autoStarted: null,
    cycle: sampleCycle(),
    next: { intervalType: "short_break" },
    ...overrides,
  };
}

function stubService(overrides: Partial<TimerService> = {}): TimerService {
  const notImplemented = async (): Promise<never> => {
    throw new Error("not implemented in stub");
  };
  return {
    current: notImplemented,
    start: notImplemented,
    pause: notImplemented,
    resume: notImplemented,
    complete: notImplemented,
    cancel: notImplemented,
    skipBreak: notImplemented,
    ...overrides,
  } as TimerService;
}

function deps(overrides: Partial<TimerHandlerDeps> = {}): TimerHandlerDeps {
  return {
    getService: async () => stubService(),
    getSession: async () => appSession,
    appUrl: APP_URL,
    ...overrides,
  };
}

function postRequest(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${APP_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APP_URL,
      ...headers,
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
}

describe("guard rails (every handler)", () => {
  it("returns 401 when signed out", async () => {
    const signedOut = deps({ getSession: async () => null });
    await expect(
      createCurrentTimerHandler(signedOut)(
        new Request(`${APP_URL}/api/timer/current`, { method: "GET" }),
      ),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      createStartTimerHandler(signedOut)(postRequest("/api/timer/start", {})),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      createPauseTimerHandler(signedOut)(postRequest("/api/timer/pause")),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      createResumeTimerHandler(signedOut)(postRequest("/api/timer/resume")),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      createCompleteTimerHandler(signedOut)(postRequest("/api/timer/complete")),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      createCancelTimerHandler(signedOut)(postRequest("/api/timer/cancel")),
    ).resolves.toMatchObject({ status: 401 });
    await expect(
      createSkipBreakTimerHandler(signedOut)(
        postRequest("/api/timer/skip-break"),
      ),
    ).resolves.toMatchObject({ status: 401 });
  });

  it("blocks cookie-bearing cross-origin mutations with 403", async () => {
    const handler = createStartTimerHandler(deps());
    const res = await handler(
      postRequest(
        "/api/timer/start",
        { intervalType: "focus" },
        { cookie: "focusflow-session=sess-abc", origin: "https://evil.example" },
      ),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "ORIGIN_MISMATCH",
    );
  });

  it("maps unexpected failures to a leak-free 500", async () => {
    const handler = createCurrentTimerHandler(
      deps({
        getService: async () => {
          throw new Error("connect ECONNREFUSED postgres://secret@db:5432");
        },
      }),
    );
    const res = await handler(
      new Request(`${APP_URL}/api/timer/current`, { method: "GET" }),
    );
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("INTERNAL_ERROR");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("postgres://");
  });
});

describe("GET /api/timer/current", () => {
  it("returns the active session, or null when idle", async () => {
    const result = sampleCurrent();
    const current = vi.fn(async () => result);
    const res = await createCurrentTimerHandler(
      deps({ getService: async () => stubService({ current }) }),
    )(new Request(`${APP_URL}/api/timer/current`, { method: "GET" }));
    expect(res.status).toBe(200);
    expect(current).toHaveBeenCalledWith("user-1");
    await expect(res.json()).resolves.toEqual(result);

    const idleResult = sampleCurrent({ session: null, next: { intervalType: "focus" } });
    const idle = vi.fn(async () => idleResult);
    const idleRes = await createCurrentTimerHandler(
      deps({ getService: async () => stubService({ current: idle }) }),
    )(new Request(`${APP_URL}/api/timer/current`, { method: "GET" }));
    expect(idleRes.status).toBe(200);
    await expect(idleRes.json()).resolves.toEqual(idleResult);
  });

  it("passes reconcile outcomes through untouched", async () => {
    const pending = sampleCurrent({
      pendingConfirmation: {
        session: sampleSession(),
        overdueSeconds: 7200,
      },
    });
    const res = await createCurrentTimerHandler(
      deps({
        getService: async () => stubService({ current: vi.fn(async () => pending) }),
      }),
    )(new Request(`${APP_URL}/api/timer/current`, { method: "GET" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(pending);
  });
});

describe("POST /api/timer/start", () => {
  it("starts with 201 scoped to the session user", async () => {
    const session = sampleSession();
    const start = vi.fn(async () => session);
    const res = await createStartTimerHandler(
      deps({ getService: async () => stubService({ start }) }),
    )(postRequest("/api/timer/start", { intervalType: "focus" }));
    expect(res.status).toBe(201);
    expect(start).toHaveBeenCalledWith("user-1", { intervalType: "focus" });
    await expect(res.json()).resolves.toEqual({ session });
  });

  it("maps a second start to 409 ACTIVE_TIMER_EXISTS", async () => {
    const res = await createStartTimerHandler(
      deps({
        getService: async () =>
          stubService({
            start: async () => {
              throw new TimerServiceError(
                "ACTIVE_TIMER_EXISTS",
                "Finish or cancel the current interval before starting another.",
              );
            },
          }),
      }),
    )(postRequest("/api/timer/start", { intervalType: "focus" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "ACTIVE_TIMER_EXISTS",
    );
  });

  it("maps unknown tasks to leak-free 404", async () => {
    const res = await createStartTimerHandler(
      deps({
        getService: async () =>
          stubService({
            start: async () => {
              throw new TimerServiceError("NOT_FOUND", "Not found.");
            },
          }),
      }),
    )(postRequest("/api/timer/start", { intervalType: "focus" }));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/timer/pause + /resume", () => {
  it("pauses and resumes through the session user", async () => {
    const paused = { ...sampleSession(), status: "paused" as const };
    const pause = vi.fn(async () => paused);
    const pauseRes = await createPauseTimerHandler(
      deps({ getService: async () => stubService({ pause }) }),
    )(postRequest("/api/timer/pause"));
    expect(pauseRes.status).toBe(200);
    expect(pause).toHaveBeenCalledWith("user-1");

    const running = sampleSession();
    const resume = vi.fn(async () => running);
    const resumeRes = await createResumeTimerHandler(
      deps({ getService: async () => stubService({ resume }) }),
    )(postRequest("/api/timer/resume"));
    expect(resumeRes.status).toBe(200);
    expect(resume).toHaveBeenCalledWith("user-1");
  });

  it("maps missing timers to 409 NO_ACTIVE_TIMER and bad moves to INVALID_TRANSITION", async () => {
    const noActive = deps({
      getService: async () =>
        stubService({
          pause: async () => {
            throw new TimerServiceError(
              "NO_ACTIVE_TIMER",
              "No active interval. Start one first.",
            );
          },
        }),
    });
    const missing = await createPauseTimerHandler(noActive)(
      postRequest("/api/timer/pause"),
    );
    expect(missing.status).toBe(409);
    expect(
      ((await missing.json()) as { error: { code: string } }).error.code,
    ).toBe("NO_ACTIVE_TIMER");

    const badMove = deps({
      getService: async () =>
        stubService({
          resume: async () => {
            throw new TimerServiceError(
              "INVALID_TRANSITION",
              "Only a paused interval can be resumed.",
            );
          },
        }),
    });
    const invalid = await createResumeTimerHandler(badMove)(
      postRequest("/api/timer/resume"),
    );
    expect(invalid.status).toBe(409);
    expect(
      ((await invalid.json()) as { error: { code: string } }).error.code,
    ).toBe("INVALID_TRANSITION");
  });
});

describe("POST /api/timer/complete + /cancel + /skip-break", () => {
  it("forwards the Idempotency-Key header to the service", async () => {
    const result = sampleFinalize();
    const complete = vi.fn(async () => result);
    const res = await createCompleteTimerHandler(
      deps({ getService: async () => stubService({ complete }) }),
    )(
      postRequest("/api/timer/complete", undefined, {
        "idempotency-key": "key-1",
      }),
    );
    expect(res.status).toBe(200);
    expect(complete).toHaveBeenCalledWith("user-1", {
      idempotencyKey: "key-1",
    });
    await expect(res.json()).resolves.toEqual(result);
  });

  it("finalizes without a key when the header is absent", async () => {
    const result = sampleFinalize({
      session: { ...sampleSession(), status: "cancelled" },
      next: { intervalType: "focus" },
    });
    const cancel = vi.fn(async () => result);
    const res = await createCancelTimerHandler(
      deps({ getService: async () => stubService({ cancel }) }),
    )(postRequest("/api/timer/cancel"));
    expect(res.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith("user-1", { idempotencyKey: null });
    await expect(res.json()).resolves.toEqual(result);
  });

  it("maps repeat finalization to 409 ALREADY_FINALIZED", async () => {
    const res = await createCompleteTimerHandler(
      deps({
        getService: async () =>
          stubService({
            complete: async () => {
              throw new TimerServiceError(
                "ALREADY_FINALIZED",
                "This interval was already finalized.",
              );
            },
          }),
      }),
    )(postRequest("/api/timer/complete", undefined, { "idempotency-key": "key-2" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "ALREADY_FINALIZED",
    );
  });

  it("maps malformed keys to 400 and skipped focus to 409", async () => {
    const badKey = await createCancelTimerHandler(
      deps({
        getService: async () =>
          stubService({
            cancel: async () => {
              throw new TimerServiceError(
                "VALIDATION_ERROR",
                "Check the highlighted fields and try again.",
                { idempotencyKey: ["Enter an idempotency key."] },
              );
            },
          }),
      }),
    )(postRequest("/api/timer/cancel", undefined, { "idempotency-key": "   " }));
    expect(badKey.status).toBe(400);

    const notABreak = await createSkipBreakTimerHandler(
      deps({
        getService: async () =>
          stubService({
            skipBreak: async () => {
              throw new TimerServiceError(
                "INVALID_TRANSITION",
                "Only a break can be skipped.",
              );
            },
          }),
      }),
    )(postRequest("/api/timer/skip-break"));
    expect(notABreak.status).toBe(409);
    expect(
      ((await notABreak.json()) as { error: { code: string } }).error.code,
    ).toBe("INVALID_TRANSITION");
  });

  it("skips through the session user", async () => {
    const result = sampleFinalize({
      session: { ...sampleSession(), status: "cancelled" },
      next: { intervalType: "focus" },
    });
    const skipBreak = vi.fn(async () => result);
    const res = await createSkipBreakTimerHandler(
      deps({ getService: async () => stubService({ skipBreak }) }),
    )(postRequest("/api/timer/skip-break"));
    expect(res.status).toBe(200);
    expect(skipBreak).toHaveBeenCalledWith("user-1", { idempotencyKey: null });
    await expect(res.json()).resolves.toEqual(result);
  });
});
