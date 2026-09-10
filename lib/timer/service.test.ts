import { describe, expect, it } from "vitest";
import {
  TimerServiceError,
  computeActualDurationSeconds,
  computeElapsedSeconds,
  createTimerService,
  isFullExpiry,
  type TimerPorts,
  type TimerRow,
} from "./service";
/**
 * Seam 2 (unit, hermetic): timer domain logic over an in-memory fake store.
 * No Prisma, no HTTP — behavior proven through the service interface with a
 * controllable clock (TEST_STRATEGY §2: timer math takes `now` as a
 * parameter; pause travel is proven by traveling the clock, never by
 * waiting). Per-user scoping is structural (every fake row keys by userId,
 * as the Prisma store's `where: { userId }` predicates do); cross-user
 * denial lands in the live-DB integration suite.
 */

const T0 = new Date("2026-09-10T12:00:00.000Z");
const at = (secondsAfterT0: number): Date =>
  new Date(T0.getTime() + secondsAfterT0 * 1000);

function uuid(): string {
  return crypto.randomUUID();
}

interface FakeTask {
  id: string;
  userId: string;
  title: string;
  category: string | null;
  status: "active" | "completed" | "archived";
  deletedAt: Date | null;
}

interface FakeDb {
  sessions: TimerRow[];
  keys: { userId: string; key: string; sessionId: string; createdAt: Date }[];
  tasks: FakeTask[];
  cycleCounts: Map<string, number>;
  durations: Map<string, { focusDurationSeconds: number; shortBreakSeconds: number; longBreakSeconds: number }>;
}

function fakePorts(db: FakeDb, clock: { now: Date }): TimerPorts {
  const activeOf = (userId: string): TimerRow | null =>
    db.sessions.find(
      (s) =>
        s.userId === userId && (s.status === "running" || s.status === "paused"),
    ) ?? null;
  return {
    now: () => clock.now,
    store: {
      async getDurations(userId) {
        return (
          db.durations.get(userId) ?? {
            focusDurationSeconds: 1500,
            shortBreakSeconds: 300,
            longBreakSeconds: 900,
          }
        );
      },
      async findTaskSnapshot(userId, taskId) {
        const task = db.tasks.find(
          (t) => t.id === taskId && t.userId === userId,
        );
        if (!task) return null;
        return {
          title: task.title,
          category: task.category,
          status: task.status,
          deletedAt: task.deletedAt,
        };
      },
      async findActive(userId) {
        return activeOf(userId);
      },
      async findSessionById(userId, sessionId) {
        return (
          db.sessions.find((s) => s.id === sessionId && s.userId === userId) ??
          null
        );
      },
      async findLatest(userId) {
        const rows = db.sessions
          .filter((s) => s.userId === userId)
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        return rows[0] ?? null;
      },
      async findIdempotency(userId, key) {
        return (
          db.keys.find((k) => k.userId === userId && k.key === key) ?? null
        );
      },
      async createActive(input) {
        if (activeOf(input.userId)) {
          throw Object.assign(new Error("one active per user"), {
            code: "ACTIVE_TIMER_EXISTS",
          });
        }
        const now = clock.now;
        const row: TimerRow = {
          id: uuid(),
          userId: input.userId,
          taskId: input.taskId,
          taskTitleSnapshot: null,
          categorySnapshot: null,
          intervalType: input.intervalType,
          status: "running",
          plannedDurationSeconds: input.plannedDurationSeconds,
          actualDurationSeconds: null,
          startedAt: input.startedAt,
          expectedEndAt: input.expectedEndAt,
          pausedAt: null,
          accumulatedPauseSeconds: 0,
          completedAt: null,
          cancelledAt: null,
          createdAt: now,
          updatedAt: now,
        };
        db.sessions.push(row);
        return row;
      },
      async tryPause(userId, now) {
        const active = activeOf(userId);
        if (!active) return { ok: false as const, reason: "NO_ACTIVE" as const };
        if (active.status !== "running") {
          return { ok: false as const, reason: "NOT_RUNNING" as const };
        }
        active.status = "paused";
        active.pausedAt = now;
        active.updatedAt = now;
        return { ok: true as const, row: active };
      },
      async tryResume(userId, now) {
        const active = activeOf(userId);
        if (!active) return { ok: false as const, reason: "NO_ACTIVE" as const };
        if (active.status !== "paused" || !active.pausedAt) {
          return { ok: false as const, reason: "NOT_PAUSED" as const };
        }
        const gap = Math.max(
          0,
          Math.floor((now.getTime() - active.pausedAt.getTime()) / 1000),
        );
        active.accumulatedPauseSeconds += gap;
        active.expectedEndAt = new Date(
          active.expectedEndAt.getTime() + gap * 1000,
        );
        active.pausedAt = null;
        active.status = "running";
        active.updatedAt = now;
        return { ok: true as const, row: active };
      },
      async tryFinalize(userId, input) {
        if (
          db.keys.some((k) => k.userId === userId && k.key === input.key) &&
          input.key !== null
        ) {
          return { ok: false as const, reason: "KEY_CONFLICT" as const };
        }
        const active = activeOf(userId);
        if (!active) {
          return { ok: false as const, reason: "NO_ACTIVE" as const };
        }
        if (input.expectActiveId !== undefined && active.id !== input.expectActiveId) {
          return { ok: false as const, reason: "NO_ACTIVE" as const };
        }
        if (input.requireBreak && active.intervalType === "focus") {
          return { ok: false as const, reason: "NOT_A_BREAK" as const };
        }
        active.status = input.status;
        active.actualDurationSeconds = input.actualDurationSeconds;
        active.taskTitleSnapshot = input.taskTitleSnapshot;
        active.categorySnapshot = input.categorySnapshot;
        if (input.status === "completed") active.completedAt = input.at;
        else active.cancelledAt = input.at;
        active.pausedAt = null;
        active.updatedAt = input.at;
        if (input.cycleOp.kind === "increment") {
          db.cycleCounts.set(userId, (db.cycleCounts.get(userId) ?? 0) + 1);
        } else if (input.cycleOp.kind === "reset") {
          db.cycleCounts.set(userId, 0);
        }
        if (input.key !== null) {
          db.keys.push({
            userId,
            key: input.key,
            sessionId: active.id,
            createdAt: input.at,
          });
        }
        // Hygiene parity with the Prisma store (IDEMPOTENCY_TTL_MS lazy prune).
        db.keys = db.keys.filter(
          (k) =>
            k.userId !== userId ||
            k.createdAt.getTime() > input.at.getTime() - 24 * 60 * 60 * 1000,
        );
        return { ok: true as const, row: active };
      },
    },
  };
}

function setup(durations?: { focusDurationSeconds: number; shortBreakSeconds: number; longBreakSeconds: number }) {
  const db: FakeDb = {
    sessions: [],
    keys: [],
    tasks: [],
    cycleCounts: new Map(),
    durations: new Map(),
  };
  const clock = { now: T0 };
  if (durations) db.durations.set("user-1", durations);
  const service = createTimerService(fakePorts(db, clock));
  return { db, clock, service };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TimerServiceError);
    return (error as TimerServiceError).code;
  }
  throw new Error("expected a TimerServiceError");
}

describe("pure pause/cycle math", () => {
  it("computes elapsed wall time minus accumulated pauses", () => {
    // 100s wall, 30s of pauses → 70s of focus.
    expect(
      computeElapsedSeconds(at(0), at(100), 30),
    ).toBe(70);
    // Paused gap never drives elapsed negative.
    expect(computeElapsedSeconds(at(0), at(10), 30)).toBe(0);
  });

  it("bounds actual duration to [0, planned]", () => {
    expect(
      computeActualDurationSeconds({
        startedAt: at(0),
        effectiveEnd: at(100),
        accumulatedPauseSeconds: 0,
        plannedDurationSeconds: 1500,
      }),
    ).toBe(100);
    // Late completion caps at the plan (no bonus minutes past expiry).
    expect(
      computeActualDurationSeconds({
        startedAt: at(0),
        effectiveEnd: at(2000),
        accumulatedPauseSeconds: 0,
        plannedDurationSeconds: 1500,
      }),
    ).toBe(1500);
  });

  it("detects full expiry from timestamps (early vs at/after end)", () => {
    expect(
      isFullExpiry({ effectiveEnd: at(1499), expectedEndAt: at(1500) }),
    ).toBe(false);
    expect(
      isFullExpiry({ effectiveEnd: at(1500), expectedEndAt: at(1500) }),
    ).toBe(true);
    expect(
      isFullExpiry({ effectiveEnd: at(1600), expectedEndAt: at(1500) }),
    ).toBe(true);
  });
});

describe("current", () => {
  it("returns null when idle", async () => {
    const { service } = setup();
    await expect(service.current("user-1")).resolves.toEqual({
      session: null,
    });
  });
});

describe("start", () => {
  it("creates one running session with planned duration and expected end from settings", async () => {
    const { service } = setup();
    const session = await service.start("user-1", { intervalType: "focus" });
    expect(session).toMatchObject({
      intervalType: "focus",
      status: "running",
      plannedDurationSeconds: 1500,
      startedAt: T0.toISOString(),
      expectedEndAt: at(1500).toISOString(),
      accumulatedPauseSeconds: 0,
      pausedAt: null,
      taskId: null,
    });
  });

  it("reads break durations from saved settings (seconds units, no conversion)", async () => {
    const { service } = setup({ focusDurationSeconds: 60, shortBreakSeconds: 120, longBreakSeconds: 180 });
    await expect(
      service.start("user-1", { intervalType: "short_break" }),
    ).resolves.toMatchObject({ plannedDurationSeconds: 120 });
  });

  it("links the selected task and rejects a second start with ACTIVE_TIMER_EXISTS", async () => {
    const { db, service } = setup();
    const taskId = uuid();
    db.tasks.push({
      id: taskId,
      userId: "user-1",
      title: "Write report",
      category: "work",
      status: "active",
      deletedAt: null,
    });
    const first = await service.start("user-1", {
      intervalType: "focus",
      taskId,
    });
    expect(first.taskId).toBe(taskId);
    expect(await codeOf(service.start("user-1", { intervalType: "focus" }))).toBe(
      "ACTIVE_TIMER_EXISTS",
    );
    expect(
      db.sessions.filter(
        (s) => s.status === "running" || s.status === "paused",
      ),
    ).toHaveLength(1);
  });

  it("hides foreign tasks as NOT_FOUND and refuses non-active tasks", async () => {
    const { db, service } = setup();
    const foreignId = uuid();
    db.tasks.push({
      id: foreignId,
      userId: "user-2",
      title: "Theirs",
      category: null,
      status: "active",
      deletedAt: null,
    });
    expect(
      await codeOf(
        service.start("user-1", { intervalType: "focus", taskId: foreignId }),
      ),
    ).toBe("NOT_FOUND");
    const doneId = uuid();
    db.tasks.push({
      id: doneId,
      userId: "user-1",
      title: "Done",
      category: null,
      status: "completed",
      deletedAt: null,
    });
    expect(
      await codeOf(
        service.start("user-1", { intervalType: "focus", taskId: doneId }),
      ),
    ).toBe("VALIDATION_ERROR");
    expect(
      await codeOf(service.start("user-1", { intervalType: "nap" })),
    ).toBe("VALIDATION_ERROR");
  });
});

describe("pause / resume", () => {
  it("pauses a running interval and freezes accrual across clock travel", async () => {
    const { clock, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(100);
    const paused = await service.pause("user-1");
    expect(paused).toMatchObject({
      status: "paused",
      pausedAt: at(100).toISOString(),
    });
    // Five minutes pass while paused: remaining time must not move and the
    // gap must later be excluded from the actual duration.
    clock.now = at(400);
    const resumed = await service.resume("user-1");
    expect(resumed).toMatchObject({
      status: "running",
      pausedAt: null,
      accumulatedPauseSeconds: 300,
      expectedEndAt: at(1800).toISOString(),
    });
  });

  it("rejects illegal moves (double-pause, resume-while-running, none active)", async () => {
    const { service } = setup();
    expect(await codeOf(service.pause("user-1"))).toBe("NO_ACTIVE_TIMER");
    expect(await codeOf(service.resume("user-1"))).toBe("NO_ACTIVE_TIMER");
    await service.start("user-1", { intervalType: "focus" });
    expect(await codeOf(service.resume("user-1"))).toBe("INVALID_TRANSITION");
    await service.pause("user-1");
    expect(await codeOf(service.pause("user-1"))).toBe("INVALID_TRANSITION");
  });
});

describe("complete / cancel", () => {
  it("completes early with elapsed minutes but no cycle increment", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(600);
    const done = await service.complete("user-1", {});
    expect(done).toMatchObject({
      status: "completed",
      actualDurationSeconds: 600,
    });
    expect(db.cycleCounts.get("user-1") ?? 0).toBe(0);
  });

  it("completes at expiry with bounded minutes and exactly one cycle bump", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500);
    const done = await service.complete("user-1", {});
    expect(done).toMatchObject({
      status: "completed",
      actualDurationSeconds: 1500,
    });
    expect(db.cycleCounts.get("user-1")).toBe(1);
  });

  it("caps late completion at the planned duration", async () => {
    const { clock, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(2000);
    const done = await service.complete("user-1", {});
    expect(done.actualDurationSeconds).toBe(1500);
  });

  it("excludes paused gaps from the actual duration on finalize", async () => {
    const { clock, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(100);
    await service.pause("user-1");
    clock.now = at(400);
    await service.resume("user-1");
    clock.now = at(700);
    // 100s before pause + 300s after resume = 400s of focus.
    const done = await service.complete("user-1", {});
    expect(done.actualDurationSeconds).toBe(400);
  });

  it("finalizes a paused interval from the pause timestamp, not the finalize time", async () => {
    const { clock, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(100);
    await service.pause("user-1");
    clock.now = at(9999);
    const done = await service.complete("user-1", {});
    expect(done.actualDurationSeconds).toBe(100);
  });

  it("writes task/category snapshots on finalize", async () => {
    const { db, service } = setup();
    const taskId = uuid();
    db.tasks.push({
      id: taskId,
      userId: "user-1",
      title: "Trip",
      category: "travel",
      status: "active",
      deletedAt: null,
    });
    await service.start("user-1", { intervalType: "focus", taskId });
    const done = await service.complete("user-1", {});
    expect(done).toMatchObject({
      taskTitleSnapshot: "Trip",
      categorySnapshot: "travel",
    });
  });

  it("cancels without touching the cycle count", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500);
    const cancelled = await service.cancel("user-1", {});
    expect(cancelled.status).toBe("cancelled");
    expect(db.cycleCounts.get("user-1") ?? 0).toBe(0);
  });

  it("replays the same Idempotency-Key instead of finalizing twice (one cycle bump max)", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500);
    const first = await service.complete("user-1", { idempotencyKey: "key-1" });
    const second = await service.complete("user-1", { idempotencyKey: "key-1" });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("completed");
    expect(db.cycleCounts.get("user-1")).toBe(1);
    expect(db.sessions).toHaveLength(1);
  });

  it("conflicts with ALREADY_FINALIZED on a different key after finalize", async () => {
    const { clock, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500);
    await service.complete("user-1", { idempotencyKey: "key-1" });
    expect(
      await codeOf(service.complete("user-1", { idempotencyKey: "key-2" })),
    ).toBe("ALREADY_FINALIZED");
    expect(await codeOf(service.complete("user-1", {}))).toBe(
      "ALREADY_FINALIZED",
    );
    expect(await codeOf(service.cancel("user-1", {}))).toBe(
      "ALREADY_FINALIZED",
    );
  });

  it("reports NO_ACTIVE_TIMER when finalizing with no history at all", async () => {
    const { service } = setup();
    expect(await codeOf(service.complete("user-1", {}))).toBe("NO_ACTIVE_TIMER");
    expect(await codeOf(service.cancel("user-1", {}))).toBe("NO_ACTIVE_TIMER");
    expect(await codeOf(service.skipBreak("user-1", {}))).toBe(
      "NO_ACTIVE_TIMER",
    );
  });

  it("rejects malformed idempotency keys as validation failures", async () => {
    const { service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    expect(await codeOf(service.complete("user-1", { idempotencyKey: "" }))).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      await codeOf(service.complete("user-1", { idempotencyKey: "x".repeat(129) })),
    ).toBe("VALIDATION_ERROR");
  });
});

describe("skip-break and long-break cycle reset", () => {
  it("refuses to skip a focus interval", async () => {
    const { service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    expect(await codeOf(service.skipBreak("user-1", {}))).toBe(
      "INVALID_TRANSITION",
    );
  });

  it("skips a short break without touching the cycle count", async () => {
    const { db, service } = setup();
    db.cycleCounts.set("user-1", 2);
    await service.start("user-1", { intervalType: "short_break" });
    const skipped = await service.skipBreak("user-1", {});
    expect(skipped.status).toBe("cancelled");
    expect(db.cycleCounts.get("user-1")).toBe(2);
  });

  it("resets the cycle count on long-break complete and long-break skip", async () => {
    const { db, service } = setup();
    db.cycleCounts.set("user-1", 3);
    await service.start("user-1", { intervalType: "long_break" });
    const done = await service.complete("user-1", {});
    expect(done.status).toBe("completed");
    expect(db.cycleCounts.get("user-1")).toBe(0);

    db.cycleCounts.set("user-1", 3);
    await service.start("user-1", { intervalType: "long_break" });
    const skipped = await service.skipBreak("user-1", {});
    expect(skipped.status).toBe("cancelled");
    expect(db.cycleCounts.get("user-1")).toBe(0);
  });

  it("break completions never increment the cycle count", async () => {
    const { db, service } = setup();
    await service.start("user-1", { intervalType: "short_break" });
    await service.complete("user-1", {});
    expect(db.cycleCounts.get("user-1") ?? 0).toBe(0);
  });
});

describe("interval type plumbing", () => {
  it("keeps the declared interval type on the row", async () => {
    const { service } = setup();
    const session = await service.start("user-1", {
      intervalType: "short_break",
    });
    expect(session.intervalType).toBe("short_break");
  });
});
