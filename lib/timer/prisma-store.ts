import type { PrismaClient } from "@prisma/client";
import { IDEMPOTENCY_TTL_MS, type IntervalType, type TimerRow, type TimerStore } from "./service";

const DEFAULT_DURATIONS = {
  focusDurationSeconds: 1500,
  shortBreakSeconds: 300,
  longBreakSeconds: 900,
} as const;

function toRow(row: {
  id: string;
  userId: string;
  taskId: string | null;
  taskTitleSnapshot: string | null;
  categorySnapshot: string | null;
  intervalType: IntervalType;
  status: TimerRow["status"];
  plannedDurationSeconds: number;
  actualDurationSeconds: number | null;
  startedAt: Date;
  expectedEndAt: Date;
  pausedAt: Date | null;
  accumulatedPauseSeconds: number;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TimerRow {
  return { ...row };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

/**
 * Production store: TimerStore over Prisma (the only data-access path per
 * SYSTEM_DESIGN §1). Every method scopes by `userId` — identity always
 * arrives from the session via the service, never from client input
 * (spec §11.5). Thin mapping + atomic writes only; all domain rules
 * (planned durations, pause math, actual bounds, cycle ops) are decided in
 * service.ts and arrive here as values. Live-DB coverage lands in
 * app/api/timer/timer.integration.test.ts.
 */
export function createPrismaTimerStore(db: PrismaClient): TimerStore {
  async function activeOf(userId: string) {
    return db.timerSession.findFirst({
      where: { userId, status: { in: ["running", "paused"] } },
    });
  }

  return {
    async getDurations(userId) {
      // Settings cutover (spec §8.5): the plan is read at start time, so
      // later settings edits never rewrite a running interval. Row-less
      // users (pre-04 shape) fall back to spec §10.2 defaults instead of
      // failing the start — GET /api/settings bootstraps separately.
      const settings = await db.userSettings.findUnique({
        where: { userId },
        select: {
          focusDurationSeconds: true,
          shortBreakSeconds: true,
          longBreakSeconds: true,
        },
      });
      return settings ?? { ...DEFAULT_DURATIONS };
    },

    async findTaskSnapshot(userId, taskId) {
      const task = await db.task.findFirst({
        where: { id: taskId, userId },
        select: {
          title: true,
          category: true,
          status: true,
          deletedAt: true,
        },
      });
      return task;
    },

    async findActive(userId) {
      const row = await activeOf(userId);
      return row ? toRow(row) : null;
    },

    async findSessionById(userId, sessionId) {
      const row = await db.timerSession.findFirst({
        where: { id: sessionId, userId },
      });
      return row ? toRow(row) : null;
    },

    async findLatest(userId) {
      const row = await db.timerSession.findFirst({
        where: { userId },
        orderBy: { startedAt: "desc" },
      });
      return row ? toRow(row) : null;
    },

    async findIdempotency(userId, key) {
      const record = await db.timerIdempotencyKey.findUnique({
        where: { userId_key: { userId, key } },
        select: { sessionId: true },
      });
      return record;
    },

    async createActive(input) {
      // The partial unique index (spec §10.6) arbitrates concurrent
      // double-starts: the loser's P2002 propagates to the service, which
      // maps it to the same 409 ACTIVE_TIMER_EXISTS as its pre-check.
      return toRow(
        await db.timerSession.create({
          data: {
            userId: input.userId,
            intervalType: input.intervalType,
            taskId: input.taskId,
            plannedDurationSeconds: input.plannedDurationSeconds,
            startedAt: input.startedAt,
            expectedEndAt: input.expectedEndAt,
          },
        }),
      );
    },

    async tryPause(userId, now) {
      // Conditional write (spec §8.4 atomic): the status predicate and the
      // update are one statement — a concurrent pause/resume/finalize can
      // only win or lose, never interleave.
      const { count } = await db.timerSession.updateMany({
        where: { userId, status: "running" },
        data: { status: "paused", pausedAt: now },
      });
      if (count === 1) {
        const row = await activeOf(userId);
        if (!row) throw new Error("timer.tryPause: missing row after write");
        return { ok: true as const, row: toRow(row) };
      }
      const active = await activeOf(userId);
      if (!active) return { ok: false as const, reason: "NO_ACTIVE" as const };
      return { ok: false as const, reason: "NOT_RUNNING" as const };
    },

    async tryResume(userId, now) {
      const active = await activeOf(userId);
      if (!active) return { ok: false as const, reason: "NO_ACTIVE" as const };
      if (active.status !== "paused" || !active.pausedAt) {
        return { ok: false as const, reason: "NOT_PAUSED" as const };
      }
      // Pause math (SYSTEM_DESIGN §4): the gap shifts the expected end
      // forward by the same whole seconds added to the accumulator, so
      // paused time never counts toward the actual duration.
      const gapSeconds = Math.max(
        0,
        Math.floor((now.getTime() - active.pausedAt.getTime()) / 1000),
      );
      const { count } = await db.timerSession.updateMany({
        where: { userId, status: "paused" },
        data: {
          status: "running",
          pausedAt: null,
          accumulatedPauseSeconds: active.accumulatedPauseSeconds + gapSeconds,
          expectedEndAt: new Date(
            active.expectedEndAt.getTime() + gapSeconds * 1000,
          ),
        },
      });
      if (count === 1) {
        const row = await activeOf(userId);
        if (!row) throw new Error("timer.tryResume: missing row after write");
        return { ok: true as const, row: toRow(row) };
      }
      const current = await activeOf(userId);
      if (!current) return { ok: false as const, reason: "NO_ACTIVE" as const };
      return { ok: false as const, reason: "NOT_PAUSED" as const };
    },

    async tryFinalize(userId, input) {
      // Single transaction (spec §10.6): the status flip, snapshot write,
      // idempotency-key insert, and focus-cycle update land atomically —
      // concurrent double-completes finalize once with one cycle bump max.
      return db.$transaction(async (tx) => {
        if (input.key !== null) {
          const existing = await tx.timerIdempotencyKey.findUnique({
            where: { userId_key: { userId, key: input.key } },
            select: { sessionId: true },
          });
          if (existing) return { ok: false as const, reason: "KEY_CONFLICT" as const };
        }
        const active = await tx.timerSession.findFirst({
          where: { userId, status: { in: ["running", "paused"] } },
        });
        if (!active) return { ok: false as const, reason: "NO_ACTIVE" as const };
        if (input.expectActiveId !== undefined && active.id !== input.expectActiveId) {
          return { ok: false as const, reason: "NO_ACTIVE" as const };
        }
        if (input.requireBreak && active.intervalType === "focus") {
          return { ok: false as const, reason: "NOT_A_BREAK" as const };
        }
        const { count } = await tx.timerSession.updateMany({
          where: {
            id: active.id,
            userId,
            status: { in: ["running", "paused"] },
          },
          data: {
            status: input.status,
            actualDurationSeconds: input.actualDurationSeconds,
            taskTitleSnapshot: input.taskTitleSnapshot,
            categorySnapshot: input.categorySnapshot,
            pausedAt: null,
            ...(input.status === "completed"
              ? { completedAt: input.at }
              : { cancelledAt: input.at }),
          },
        });
        // Lost the race to a concurrent finalize (different key): our
        // optimistic row guard found nothing to flip.
        if (count === 0) return { ok: false as const, reason: "NO_ACTIVE" as const };
        if (input.key !== null) {
          try {
            await tx.timerIdempotencyKey.create({
              data: {
                userId,
                key: input.key,
                sessionId: active.id,
                createdAt: input.at,
              },
            });
          } catch (error) {
            // Concurrent same-key winner committed first: abort our
            // finalize (the transaction rolls back our status flip) and
            // let the service replay the winner.
            if (isUniqueViolation(error)) {
              throw Object.assign(new Error("timer.tryFinalize: key conflict"), {
                code: "KEY_CONFLICT_ABORT",
              });
            }
            throw error;
          }
        }
        if (input.cycleOp.kind === "increment") {
          await tx.focusCycleState.upsert({
            where: { userId },
            create: { userId, completedFocusCount: 1 },
            update: { completedFocusCount: { increment: 1 } },
          });
        } else if (input.cycleOp.kind === "reset") {
          await tx.focusCycleState.upsert({
            where: { userId },
            create: { userId, completedFocusCount: 0 },
            update: { completedFocusCount: 0 },
          });
        }
        // Hygiene: expired keys age out lazily (IDEMPOTENCY_TTL_MS).
        await tx.timerIdempotencyKey.deleteMany({
          where: {
            userId,
            createdAt: { lt: new Date(input.at.getTime() - IDEMPOTENCY_TTL_MS) },
          },
        });
        const row = await tx.timerSession.findFirst({
          where: { id: active.id, userId },
        });
        if (!row) throw new Error("timer.tryFinalize: missing row after write");
        return { ok: true as const, row: toRow(row) };
      }).catch((error) => {
        // The key-conflict abort above must surface as a replayable
        // KEY_CONFLICT (not a 500): the winner's row is the outcome.
        if (
          (error as { code?: unknown } | null)?.code === "KEY_CONFLICT_ABORT"
        ) {
          return { ok: false as const, reason: "KEY_CONFLICT" as const };
        }
        throw error;
      });
    },
  };
}
