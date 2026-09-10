import { describe, expect, it } from "vitest";
import {
  TimerServiceError,
  RECONCILE_GRACE_SECONDS,
  computeActualDurationSeconds,
  computeElapsedSeconds,
  createTimerService,
  isFullExpiry,
  nextBreakFor,
  type FinalizeAutoStart,
  type TimerPorts,
  type TimerRow,
  type TimerSettings,
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
  timerSettings: Map<string, TimerSettings>;
  /**
   * Test-only stale-read hook (issue 11 hardening): when non-zero,
   * `findActive` returns a *copy* whose expected end is shifted forward by
   * this many seconds while the stored row is untouched — simulating a
   * pause/resume that landed between the service's read and its write.
   */
  spoofActiveShiftSeconds: number;
}

function fakePorts(db: FakeDb, clock: { now: Date }): TimerPorts {
  const liveActiveOf = (userId: string): TimerRow | null =>
    db.sessions.find(
      (s) =>
        s.userId === userId && (s.status === "running" || s.status === "paused"),
    ) ?? null;
  const activeOf = (userId: string): TimerRow | null => {
    const live = liveActiveOf(userId);
    if (!live || db.spoofActiveShiftSeconds === 0) return live;
    return {
      ...live,
      expectedEndAt: new Date(
        live.expectedEndAt.getTime() + db.spoofActiveShiftSeconds * 1000,
      ),
    };
  };
  return {
    now: () => clock.now,
    store: {
      async getTimerSettings(userId) {
        return (
          db.timerSettings.get(userId) ?? {
            focusDurationSeconds: 1500,
            shortBreakSeconds: 300,
            longBreakSeconds: 900,
            intervalsBeforeLongBreak: 4,
            autoStartBreaks: false,
            autoStartFocus: false,
          }
        );
      },
      async getCycleCount(userId) {
        return db.cycleCounts.get(userId) ?? 0;
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
        // Hardening parity with the Prisma store: math and the cycle
        // verdict read the LIVE row at write time, never the (possibly
        // spoofed) pre-write snapshot the service passed in.
        const active = liveActiveOf(userId);
        if (!active) {
          return { ok: false as const, reason: "NO_ACTIVE" as const };
        }
        if (input.expectActiveId !== undefined && active.id !== input.expectActiveId) {
          return { ok: false as const, reason: "NO_ACTIVE" as const };
        }
        if (input.requireBreak && active.intervalType === "focus") {
          return { ok: false as const, reason: "NOT_A_BREAK" as const };
        }
        const effectiveEnd =
          active.status === "paused" && active.pausedAt
            ? active.pausedAt
            : input.at;
        const actualDurationSeconds = computeActualDurationSeconds({
          startedAt: active.startedAt,
          effectiveEnd,
          accumulatedPauseSeconds: active.accumulatedPauseSeconds,
          plannedDurationSeconds: active.plannedDurationSeconds,
        });
        const reachedFullExpiry = isFullExpiry({
          effectiveEnd,
          expectedEndAt: active.expectedEndAt,
        });
        const status = input.mode === "complete" ? "completed" : "cancelled";
        const cycleOp =
          input.mode === "complete" &&
          active.intervalType === "focus" &&
          reachedFullExpiry
            ? ("increment" as const)
            : (input.mode === "complete" || input.mode === "skip") &&
                active.intervalType === "long_break"
              ? ("reset" as const)
              : ("none" as const);
        active.status = status;
        active.actualDurationSeconds = actualDurationSeconds;
        active.taskTitleSnapshot = input.taskTitleSnapshot;
        active.categorySnapshot = input.categorySnapshot;
        if (status === "completed") active.completedAt = input.at;
        else active.cancelledAt = input.at;
        active.pausedAt = null;
        active.updatedAt = input.at;
        if (cycleOp === "increment") {
          db.cycleCounts.set(userId, (db.cycleCounts.get(userId) ?? 0) + 1);
        } else if (cycleOp === "reset") {
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
        const cycleCount = db.cycleCounts.get(userId) ?? 0;
        const proposal =
          status === "completed" && active.intervalType === "focus"
            ? nextBreakFor(cycleCount, input.intervalsBeforeLongBreak)
            : ("focus" as const);
        let autoStarted: TimerRow | null = null;
        const auto: FinalizeAutoStart | null = input.autoStart;
        const wantsAutoStart =
          auto !== null &&
          ((input.mode === "complete" &&
            active.intervalType === "focus" &&
            auto.onFocusComplete) ||
            ((input.mode === "complete" || input.mode === "skip") &&
              active.intervalType !== "focus" &&
              auto.onBreakFinalize));
        if (wantsAutoStart && auto !== null) {
          const plannedDurationSeconds =
            proposal === "focus"
              ? auto.focusSeconds
              : proposal === "short_break"
                ? auto.shortSeconds
                : auto.longSeconds;
          autoStarted = {
            id: uuid(),
            userId,
            taskId: null,
            taskTitleSnapshot: null,
            categorySnapshot: null,
            intervalType: proposal,
            status: "running",
            plannedDurationSeconds,
            actualDurationSeconds: null,
            startedAt: input.at,
            expectedEndAt: new Date(
              input.at.getTime() + plannedDurationSeconds * 1000,
            ),
            pausedAt: null,
            accumulatedPauseSeconds: 0,
            completedAt: null,
            cancelledAt: null,
            createdAt: input.at,
            updatedAt: input.at,
          };
          db.sessions.push(autoStarted);
        }
        // Hygiene parity with the Prisma store (IDEMPOTENCY_TTL_MS lazy prune).
        db.keys = db.keys.filter(
          (k) =>
            k.userId !== userId ||
            k.createdAt.getTime() > input.at.getTime() - 24 * 60 * 60 * 1000,
        );
        return { ok: true as const, row: active, cycleCount, autoStarted };
      },
    },
  };
}

function setup(partialSettings?: Partial<TimerSettings>) {
  const db: FakeDb = {
    sessions: [],
    keys: [],
    tasks: [],
    cycleCounts: new Map(),
    timerSettings: new Map(),
    spoofActiveShiftSeconds: 0,
  };
  const clock = { now: T0 };
  if (partialSettings) {
    db.timerSettings.set("user-1", {
      focusDurationSeconds: 1500,
      shortBreakSeconds: 300,
      longBreakSeconds: 900,
      intervalsBeforeLongBreak: 4,
      autoStartBreaks: false,
      autoStartFocus: false,
      ...partialSettings,
    });
  }
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

describe("break proposal (spec §8.5)", () => {
  it("proposes a long break exactly when the count reaches the configured threshold", () => {
    // Threshold 4: counts 1–3 propose short, count 4 proposes long.
    expect(nextBreakFor(1, 4)).toBe("short_break");
    expect(nextBreakFor(3, 4)).toBe("short_break");
    expect(nextBreakFor(4, 4)).toBe("long_break");
    // Past the threshold the next cycle starts over (count 5 → short).
    expect(nextBreakFor(5, 4)).toBe("short_break");
    expect(nextBreakFor(8, 4)).toBe("long_break");
    // Degenerate threshold 1: every focus earns a long break.
    expect(nextBreakFor(1, 1)).toBe("long_break");
    // A reset count proposes short.
    expect(nextBreakFor(0, 4)).toBe("short_break");
  });
});

describe("current", () => {
  it("returns null when idle", async () => {
    const { service } = setup();
    await expect(service.current("user-1")).resolves.toMatchObject({
      session: null,
      reconciled: null,
      pendingConfirmation: null,
      autoStarted: null,
      cycle: { completedFocusCount: 0, intervalsBeforeLongBreak: 4 },
      next: { intervalType: "focus" },
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
  it("finalizes from write-time state when the pre-write snapshot went stale", async () => {
    // Pause/finalize race (issue 11 hardening): the service's pre-write
    // read sees a copy whose expected end still lies ahead, while the
    // stored row already expired. The write must still record bounded
    // minutes and the full-expiry cycle increment — computed from the row
    // as read inside the write, never from the stale snapshot.
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1600);
    db.spoofActiveShiftSeconds = 9999;
    const done = await service.complete("user-1", {});
    expect(done.session).toMatchObject({
      status: "completed",
      actualDurationSeconds: 1500,
    });
    expect(done.cycle.completedFocusCount).toBe(1);
  });

  it("completes early with elapsed minutes but no cycle increment", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(600);
    const done = await service.complete("user-1", {});
    expect(done.session).toMatchObject({
      status: "completed",
      actualDurationSeconds: 600,
    });
    expect(done.cycle).toMatchObject({
      completedFocusCount: 0,
      intervalsBeforeLongBreak: 4,
    });
    expect(done.next).toEqual({ intervalType: "short_break" });
    expect(done.autoStarted).toBeNull();
    expect(db.cycleCounts.get("user-1") ?? 0).toBe(0);
  });

  it("completes at expiry with bounded minutes and exactly one cycle bump", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500);
    const done = await service.complete("user-1", {});
    expect(done.session).toMatchObject({
      status: "completed",
      actualDurationSeconds: 1500,
    });
    expect(done.cycle.completedFocusCount).toBe(1);
    expect(done.next).toEqual({ intervalType: "short_break" });
    expect(db.cycleCounts.get("user-1")).toBe(1);
  });

  it("caps late completion at the planned duration", async () => {
    const { clock, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(2000);
    const done = await service.complete("user-1", {});
    expect(done.session.actualDurationSeconds).toBe(1500);
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
    expect(done.session.actualDurationSeconds).toBe(400);
  });

  it("finalizes a paused interval from the pause timestamp, not the finalize time", async () => {
    const { clock, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(100);
    await service.pause("user-1");
    clock.now = at(9999);
    const done = await service.complete("user-1", {});
    expect(done.session.actualDurationSeconds).toBe(100);
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
    expect(done.session).toMatchObject({
      taskTitleSnapshot: "Trip",
      categorySnapshot: "travel",
    });
  });

  it("cancels without touching the cycle count", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500);
    const cancelled = await service.cancel("user-1", {});
    expect(cancelled.session.status).toBe("cancelled");
    expect(cancelled.next).toEqual({ intervalType: "focus" });
    expect(cancelled.autoStarted).toBeNull();
    expect(db.cycleCounts.get("user-1") ?? 0).toBe(0);
  });

  it("replays the same Idempotency-Key instead of finalizing twice (one cycle bump max)", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500);
    const first = await service.complete("user-1", { idempotencyKey: "key-1" });
    const second = await service.complete("user-1", { idempotencyKey: "key-1" });
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.status).toBe("completed");
    expect(second.autoStarted).toBeNull();
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
    expect(skipped.session.status).toBe("cancelled");
    expect(skipped.next).toEqual({ intervalType: "focus" });
    expect(db.cycleCounts.get("user-1")).toBe(2);
  });

  it("resets the cycle count on long-break complete and long-break skip", async () => {
    const { db, service } = setup();
    db.cycleCounts.set("user-1", 3);
    await service.start("user-1", { intervalType: "long_break" });
    const done = await service.complete("user-1", {});
    expect(done.session.status).toBe("completed");
    expect(done.next).toEqual({ intervalType: "focus" });
    expect(db.cycleCounts.get("user-1")).toBe(0);

    db.cycleCounts.set("user-1", 3);
    await service.start("user-1", { intervalType: "long_break" });
    const skipped = await service.skipBreak("user-1", {});
    expect(skipped.session.status).toBe("cancelled");
    expect(db.cycleCounts.get("user-1")).toBe(0);
  });

  it("break completions never increment the cycle count", async () => {
    const { db, service } = setup();
    await service.start("user-1", { intervalType: "short_break" });
    await service.complete("user-1", {});
    expect(db.cycleCounts.get("user-1") ?? 0).toBe(0);
  });
});

describe("break proposal at the configured threshold", () => {
  async function completeFullFocus(
    service: { start: (u: string, i: unknown) => Promise<unknown>; complete: (u: string, o?: { idempotencyKey?: unknown }) => Promise<{ session: { actualDurationSeconds: number | null }; cycle: { completedFocusCount: number }; next: { intervalType: string } | null }> },
    clock: { now: Date },
  ): Promise<{ intervalType: string } | null> {
    await service.start("user-1", { intervalType: "focus" });
    clock.now = new Date(clock.now.getTime() + 1600 * 1000);
    const done = await service.complete("user-1", {});
    return done.next;
  }

  it("proposes short breaks until the count reaches the threshold, then long", async () => {
    const { clock, db, service } = setup();
    expect(await completeFullFocus(service, clock)).toEqual({
      intervalType: "short_break",
    });
    expect(await completeFullFocus(service, clock)).toEqual({
      intervalType: "short_break",
    });
    expect(await completeFullFocus(service, clock)).toEqual({
      intervalType: "short_break",
    });
    expect(await completeFullFocus(service, clock)).toEqual({
      intervalType: "long_break",
    });
    expect(db.cycleCounts.get("user-1")).toBe(4);
  });

  it("keeps proposing short after a complete-early (no increment)", async () => {
    const { clock, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(600);
    const done = await service.complete("user-1", {});
    expect(done.next).toEqual({ intervalType: "short_break" });
  });

  it("hands back to focus after any break finalization", async () => {
    const { db, service } = setup();
    db.cycleCounts.set("user-1", 4);
    await service.start("user-1", { intervalType: "long_break" });
    const done = await service.complete("user-1", {});
    expect(done.next).toEqual({ intervalType: "focus" });
  });
});

describe("auto-start (spec §8.5)", () => {
  it("starts the proposed break after focus completion when enabled", async () => {
    const { clock, db, service } = setup({ autoStartBreaks: true });
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500);
    const done = await service.complete("user-1", {});
    expect(done.session.status).toBe("completed");
    expect(done.autoStarted).toMatchObject({
      intervalType: "short_break",
      status: "running",
      plannedDurationSeconds: 300,
      taskId: null,
    });
    expect(done.next).toBeNull();
    expect(done.cycle.completedFocusCount).toBe(1);
    // Exactly two rows: the finalized focus + the auto-started break.
    expect(db.sessions).toHaveLength(2);
  });

  it("starts focus after a break finalization when enabled", async () => {
    const { db, service } = setup({ autoStartFocus: true });
    await service.start("user-1", { intervalType: "short_break" });
    const done = await service.complete("user-1", {});
    expect(done.autoStarted).toMatchObject({
      intervalType: "focus",
      status: "running",
      plannedDurationSeconds: 1500,
    });
    expect(done.next).toBeNull();
    expect(db.sessions).toHaveLength(2);
  });

  it("never auto-starts on cancel, even with both flags on", async () => {
    const { db, service } = setup({
      autoStartBreaks: true,
      autoStartFocus: true,
    });
    await service.start("user-1", { intervalType: "focus" });
    const cancelled = await service.cancel("user-1", {});
    expect(cancelled.autoStarted).toBeNull();
    expect(cancelled.next).toEqual({ intervalType: "focus" });
    expect(db.sessions).toHaveLength(1);
  });

  it("auto-starts the long break once the threshold is reached", async () => {
    const { clock, db, service } = setup({ autoStartBreaks: true });
    db.cycleCounts.set("user-1", 3);
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500);
    const done = await service.complete("user-1", {});
    expect(done.cycle.completedFocusCount).toBe(4);
    expect(done.autoStarted).toMatchObject({
      intervalType: "long_break",
      plannedDurationSeconds: 900,
    });
  });
});

describe("settings cutover (spec §8.5)", () => {
  it("keeps the running interval on its starting plan after settings change", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    db.timerSettings.set("user-1", {
      focusDurationSeconds: 60,
      shortBreakSeconds: 300,
      longBreakSeconds: 900,
      intervalsBeforeLongBreak: 4,
      autoStartBreaks: false,
      autoStartFocus: false,
    });
    // The running interval still ends 1500s after its start.
    const current = await service.current("user-1");
    expect(current.session?.plannedDurationSeconds).toBe(1500);
    expect(current.session?.expectedEndAt).toBe(at(1500).toISOString());
    // …while the next interval picks up the new plan.
    clock.now = at(600);
    await service.complete("user-1", {});
    const fresh = await service.start("user-1", { intervalType: "focus" });
    expect(fresh.plannedDurationSeconds).toBe(60);
  });
});

describe("lazy expiry reconcile (spec §8.4)", () => {
  it("holds the 60-minute grace window constant", () => {
    expect(RECONCILE_GRACE_SECONDS).toBe(3600);
  });

  it("auto-completes on current when back within the 60-minute grace window", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500 + 1800); // 30 min past the expected end
    const result = await service.current("user-1");
    expect(result.session).toBeNull();
    expect(result.reconciled).toMatchObject({
      status: "completed",
      actualDurationSeconds: 1500,
    });
    expect(result.pendingConfirmation).toBeNull();
    expect(result.autoStarted).toBeNull();
    expect(result.cycle.completedFocusCount).toBe(1);
    expect(result.next).toEqual({ intervalType: "short_break" });
    expect(db.cycleCounts.get("user-1")).toBe(1);
    // A second read reports the plain post-state — exactly one history row.
    const again = await service.current("user-1");
    expect(again.session).toBeNull();
    expect(again.reconciled).toBeNull();
    expect(db.sessions).toHaveLength(1);
  });

  it("auto-completes exactly at the grace boundary, asks beyond it", async () => {
    const { clock, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500 + 3600);
    const atBoundary = await service.current("user-1");
    expect(atBoundary.reconciled?.status).toBe("completed");

    const second = setup();
    await second.service.start("user-1", { intervalType: "focus" });
    second.clock.now = at(1500 + 3601);
    const past = await second.service.current("user-1");
    expect(past.reconciled).toBeNull();
    expect(past.session?.status).toBe("running");
    expect(past.pendingConfirmation?.overdueSeconds).toBe(3601);
    expect(past.pendingConfirmation?.session.id).toBe(past.session?.id);
    expect(second.db.cycleCounts.get("user-1") ?? 0).toBe(0);
  });

  it("judges the grace window to the millisecond, not the floored second", async () => {
    const { clock, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    // Half a second past the window is past it — no auto-complete.
    clock.now = new Date(at(1500 + 3600).getTime() + 500);
    const past = await service.current("user-1");
    expect(past.reconciled).toBeNull();
    expect(past.pendingConfirmation?.overdueSeconds).toBe(3600);
  });

  it("leaves a long-expired interval active until explicit Complete/Discard", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500 + 7200); // 2 h past the expected end
    const pending = await service.current("user-1");
    expect(pending.pendingConfirmation).not.toBeNull();
    // Nothing finalized: still one active row, no cycle movement.
    expect(
      db.sessions.filter((s) => s.status === "running" || s.status === "paused"),
    ).toHaveLength(1);
    expect(db.cycleCounts.get("user-1") ?? 0).toBe(0);

    // Complete (the dialog's Complete choice): bounded minutes + one bump.
    const completed = await service.complete("user-1", {});
    expect(completed.session).toMatchObject({
      status: "completed",
      actualDurationSeconds: 1500,
    });
    expect(db.cycleCounts.get("user-1")).toBe(1);
  });

  it("discards a long-expired interval as cancelled with no minutes and no cycle step", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500 + 7200);
    await service.current("user-1"); // surfaces pendingConfirmation, finalizes nothing
    const discarded = await service.cancel("user-1", {});
    expect(discarded.session.status).toBe("cancelled");
    expect(discarded.autoStarted).toBeNull();
    expect(db.cycleCounts.get("user-1") ?? 0).toBe(0);
  });

  it("never expires a paused interval, however long it sits", async () => {
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(100);
    await service.pause("user-1");
    clock.now = at(100 + 7200); // 2 h frozen
    const result = await service.current("user-1");
    expect(result.session?.status).toBe("paused");
    expect(result.reconciled).toBeNull();
    expect(result.pendingConfirmation).toBeNull();
    expect(db.cycleCounts.get("user-1") ?? 0).toBe(0);
    // Resume still shifts the end forward by the gap; the interval lives on.
    const resumed = await service.resume("user-1");
    expect(resumed.expectedEndAt).toBe(at(1500 + 7200).toISOString());
  });

  it("keeps the break proposal on current after an idle completion", async () => {
    const { clock, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500);
    await service.complete("user-1", {});
    const idle = await service.current("user-1");
    expect(idle.session).toBeNull();
    expect(idle.next).toEqual({ intervalType: "short_break" });
  });

  it("replays the same winner when concurrent currents overlap in the write", async () => {
    // Deterministic overlap at the service seam: both reads see the
    // expired row (microtask interleaving), the winner's key insert makes
    // the loser take KEY_CONFLICT → replay. Live-DB timing can't promise
    // this overlap, so the integration suite only pins the invariants.
    const { clock, db, service } = setup();
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500 + 1800);
    const [first, second] = await Promise.all([
      service.current("user-1"),
      service.current("user-1"),
    ]);
    expect(first.reconciled?.id).toBeDefined();
    expect(second.reconciled?.id).toBe(first.reconciled?.id);
    expect(db.sessions).toHaveLength(1);
    expect(db.cycleCounts.get("user-1")).toBe(1);
  });

  it("announces an auto-start exactly once when concurrent currents overlap", async () => {
    const { clock, db, service } = setup({ autoStartBreaks: true });
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500 + 1800);
    const [first, second] = await Promise.all([
      service.current("user-1"),
      service.current("user-1"),
    ]);
    expect(first.reconciled?.id).toBeDefined();
    expect(second.reconciled?.id).toBe(first.reconciled?.id);
    // One winner claims the creation; the replaying loser reports null.
    const starters = [first.autoStarted, second.autoStarted].filter(
      (s) => s !== null,
    );
    expect(starters).toHaveLength(1);
    expect(starters[0]).toMatchObject({
      intervalType: "short_break",
      status: "running",
    });
    expect(db.sessions).toHaveLength(2);
  });

  it("auto-starts the next interval during grace-window reconcile when enabled", async () => {
    const { clock, db, service } = setup({ autoStartBreaks: true });
    await service.start("user-1", { intervalType: "focus" });
    clock.now = at(1500 + 600);
    const result = await service.current("user-1");
    expect(result.reconciled?.status).toBe("completed");
    expect(result.autoStarted).toMatchObject({
      intervalType: "short_break",
      status: "running",
    });
    expect(result.session?.id).toBe(result.autoStarted?.id);
    expect(result.next).toBeNull();
    expect(db.sessions).toHaveLength(2);
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
