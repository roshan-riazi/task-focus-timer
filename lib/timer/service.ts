import { z } from "zod";
import { flattenZodFields } from "../auth/validation";
import type { TaskStatus } from "../tasks/service";
import {
  idempotencyKeySchema,
  startTimerSchema,
  type IntervalType,
} from "./validation";

export type { IntervalType };

export type SessionStatus = "running" | "paused" | "completed" | "cancelled";

/** Storage-shaped row (Dates in, ISO strings out via `toPublicSession`). */
export interface TimerRow {
  id: string;
  userId: string;
  taskId: string | null;
  taskTitleSnapshot: string | null;
  categorySnapshot: string | null;
  intervalType: IntervalType;
  status: SessionStatus;
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
}

export interface PublicSession {
  id: string;
  taskId: string | null;
  taskTitleSnapshot: string | null;
  categorySnapshot: string | null;
  intervalType: IntervalType;
  status: SessionStatus;
  plannedDurationSeconds: number;
  actualDurationSeconds: number | null;
  startedAt: string;
  expectedEndAt: string;
  pausedAt: string | null;
  accumulatedPauseSeconds: number;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPublicSession(row: TimerRow): PublicSession {
  return {
    id: row.id,
    taskId: row.taskId,
    taskTitleSnapshot: row.taskTitleSnapshot,
    categorySnapshot: row.categorySnapshot,
    intervalType: row.intervalType,
    status: row.status,
    plannedDurationSeconds: row.plannedDurationSeconds,
    actualDurationSeconds: row.actualDurationSeconds,
    startedAt: row.startedAt.toISOString(),
    expectedEndAt: row.expectedEndAt.toISOString(),
    pausedAt: row.pausedAt?.toISOString() ?? null,
    accumulatedPauseSeconds: row.accumulatedPauseSeconds,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type TimerErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "ACTIVE_TIMER_EXISTS"
  | "NO_ACTIVE_TIMER"
  | "ALREADY_FINALIZED"
  | "INVALID_TRANSITION";
/**
 * Typed service failure. Routes map codes to HTTP status + envelope
 * (VALIDATION_ERROR → 400 with field map, NOT_FOUND → 404 leak-free,
 * ACTIVE_TIMER_EXISTS / NO_ACTIVE_TIMER / ALREADY_FINALIZED /
 * INVALID_TRANSITION → 409); anything else is a 500.
 */
export class TimerServiceError extends Error {
  readonly fields?: Record<string, string[]>;
  constructor(
    readonly code: TimerErrorCode,
    message: string,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "TimerServiceError";
    this.fields = fields;
  }
}

export type CycleOp =
  | { kind: "none" }
  | { kind: "increment" }
  | { kind: "reset" };

/**
 * Idempotency-key retention (SYSTEM_DESIGN §6 "short TTL"): finalize keys
 * live 24 hours — long enough to cover client retries and concurrent
 * double-submits, short enough that the table stays tiny at personal
 * scale. Stores lazily prune expired rows on each finalize.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface TaskSnapshot {
  title: string;
  category: string | null;
  status: TaskStatus;
  deletedAt: Date | null;
}

/**
 * System boundaries behind the timer service (health-route factory pattern:
 * callers inject the boundary; unit tests inject the in-memory fake in
 * service.test.ts; routes inject the Prisma store in prisma-store.ts).
 * Every method scopes by `userId` — identity always arrives from the
 * session via the handlers, never from client input (spec §11.5).
 *
 * Conflict reporting uses discriminated unions (not throws) for expected
 * races so the service — not the store — owns the domain vocabulary, while
 * the writes stay atomic inside the store (conditional `updateMany` +
 * count, single `$transaction` for finalize; see prisma-store.ts).
 */
export interface TimerStore {
  getDurations(userId: string): Promise<{
    focusDurationSeconds: number;
    shortBreakSeconds: number;
    longBreakSeconds: number;
  }>;
  findTaskSnapshot(
    userId: string,
    taskId: string,
  ): Promise<TaskSnapshot | null>;
  findActive(userId: string): Promise<TimerRow | null>;
  findSessionById(userId: string, sessionId: string): Promise<TimerRow | null>;
  /** Most recent session by start time (any status), for the finalize conflict signal. */
  findLatest(userId: string): Promise<TimerRow | null>;
  findIdempotency(
    userId: string,
    key: string,
  ): Promise<{ sessionId: string } | null>;
  createActive(input: {
    userId: string;
    intervalType: IntervalType;
    taskId: string | null;
    plannedDurationSeconds: number;
    startedAt: Date;
    expectedEndAt: Date;
  }): Promise<TimerRow>;
  tryPause(
    userId: string,
    now: Date,
  ): Promise<{ ok: true; row: TimerRow } | { ok: false; reason: "NO_ACTIVE" | "NOT_RUNNING" }>;
  tryResume(
    userId: string,
    now: Date,
  ): Promise<{ ok: true; row: TimerRow } | { ok: false; reason: "NO_ACTIVE" | "NOT_PAUSED" }>;
  tryFinalize(
    userId: string,
    input: {
      key: string | null;
      status: "completed" | "cancelled";
      actualDurationSeconds: number;
      taskTitleSnapshot: string | null;
      categorySnapshot: string | null;
      at: Date;
      cycleOp: CycleOp;
      /** Optimistic guard: finalize only this row when provided. */
      expectActiveId?: string;
      /** Skip-break may only finalize a break, never a focus interval. */
      requireBreak?: boolean;
    },
  ): Promise<
    | { ok: true; row: TimerRow }
    | { ok: false; reason: "NO_ACTIVE" | "NOT_A_BREAK" | "KEY_CONFLICT" }
  >;
}

export interface TimerPorts {
  now(): Date;
  store: TimerStore;
}

// ---------------------------------------------------------------------------
// Pure pause/cycle math (unit-covered, clock-injected per TEST_STRATEGY §2)
// ---------------------------------------------------------------------------

/** Whole active seconds between two stamps minus accumulated pauses, floored at 0. */
export function computeElapsedSeconds(
  startedAt: Date,
  effectiveEnd: Date,
  accumulatedPauseSeconds: number,
): number {
  const wall = Math.floor(
    (effectiveEnd.getTime() - startedAt.getTime()) / 1000,
  );
  return Math.max(0, wall - accumulatedPauseSeconds);
}

/**
 * Final `actual_duration_seconds`: elapsed active time bounded to
 * `[0, planned]`. Late completion caps at the plan — no bonus minutes past
 * expiry (spec §8.4 bounded-minutes rule, applied to every finalize path).
 */
export function computeActualDurationSeconds(input: {
  startedAt: Date;
  effectiveEnd: Date;
  accumulatedPauseSeconds: number;
  plannedDurationSeconds: number;
}): number {
  const elapsed = computeElapsedSeconds(
    input.startedAt,
    input.effectiveEnd,
    input.accumulatedPauseSeconds,
  );
  return Math.min(Math.max(0, elapsed), input.plannedDurationSeconds);
}

/**
 * Full-expiry check (spec §8.5, decision 02): only a focus interval that
 * reaches its expected end increments the cycle count. Timestamp comparison
 * (not duration rounding) so pause-shifted ends behave identically.
 */
export function isFullExpiry(input: {
  effectiveEnd: Date;
  expectedEndAt: Date;
}): boolean {
  return input.effectiveEnd.getTime() >= input.expectedEndAt.getTime();
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function validationError(error: z.ZodError): TimerServiceError {
  return new TimerServiceError(
    "VALIDATION_ERROR",
    "Check the highlighted fields and try again.",
    flattenZodFields(error),
  );
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

function parseIdempotencyKey(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  return parse(idempotencyKeySchema, input);
}

function isUniqueActiveViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "P2002" || code === "ACTIVE_TIMER_EXISTS") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("timer_sessions_one_active_per_user");
}

export function createTimerService(ports: TimerPorts) {
  function plannedFor(
    intervalType: IntervalType,
    durations: {
      focusDurationSeconds: number;
      shortBreakSeconds: number;
      longBreakSeconds: number;
    },
  ): number {
    switch (intervalType) {
      case "focus":
        return durations.focusDurationSeconds;
      case "short_break":
        return durations.shortBreakSeconds;
      case "long_break":
        return durations.longBreakSeconds;
    }
  }

  async function replayFinalize(
    userId: string,
    key: string,
  ): Promise<PublicSession | null> {
    const record = await ports.store.findIdempotency(userId, key);
    if (!record) return null;
    const row = await ports.store.findSessionById(userId, record.sessionId);
    return row ? toPublicSession(row) : null;
  }

  /**
   * No-active-row resolution for finalize paths: a matching idempotency key
   * replays the winner (200) — this is the concurrent same-key loser path,
   * where the winner committed between our fast-path check and our write.
   * Otherwise the user's history decides — a past session means this
   * finalize already happened (409 ALREADY_FINALIZED), no history at all
   * means there was never anything to finalize (409 NO_ACTIVE_TIMER).
   */
  async function resolveNoActive(
    userId: string,
    key: string | null,
  ): Promise<PublicSession> {
    if (key !== null) {
      const replayed = await replayFinalize(userId, key);
      if (replayed) return replayed;
    }
    const latest = await ports.store.findLatest(userId);
    if (latest) {
      throw new TimerServiceError(
        "ALREADY_FINALIZED",
        "This interval was already finalized.",
      );
    }
    throw new TimerServiceError(
      "NO_ACTIVE_TIMER",
      "No active interval. Start one first.",
    );
  }

  async function finalize(
    userId: string,
    mode: "complete" | "cancel" | "skip",
    rawKey: unknown,
  ): Promise<PublicSession> {
    const key = parseIdempotencyKey(rawKey);
    const now = ports.now();

    // Fast-path replay: same key twice returns the original outcome
    // without touching the cycle count (SYSTEM_DESIGN §6).
    if (key !== null) {
      const replayed = await replayFinalize(userId, key);
      if (replayed) return replayed;
    }

    const active = await ports.store.findActive(userId);
    if (!active) return resolveNoActive(userId, key);
    if (mode === "skip" && active.intervalType === "focus") {
      throw new TimerServiceError(
        "INVALID_TRANSITION",
        "Only a break can be skipped.",
      );
    }

    const effectiveEnd =
      active.status === "paused" && active.pausedAt ? active.pausedAt : now;
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

    let taskTitleSnapshot: string | null = null;
    let categorySnapshot: string | null = null;
    if (active.taskId) {
      // Resilience over strictness: a task that vanished mid-interval
      // must not block finalization — snapshots fall back to null and
      // history still records the interval.
      const task = await ports.store.findTaskSnapshot(userId, active.taskId);
      if (task) {
        taskTitleSnapshot = task.title;
        categorySnapshot = task.category;
      }
    }

    // Cycle rules (spec §8.5, decision 02): only full-expiry focus
    // completions increment; completing or skipping a long break resets;
    // cancelling (incl. Discard) never touches the count. Breaks never
    // contribute focus minutes (analytics sums completed focus only).
    let cycleOp: CycleOp = { kind: "none" };
    if (mode === "complete" && active.intervalType === "focus" && reachedFullExpiry) {
      cycleOp = { kind: "increment" };
    } else if (
      (mode === "complete" || mode === "skip") &&
      active.intervalType === "long_break"
    ) {
      cycleOp = { kind: "reset" };
    }

    const status = mode === "complete" ? "completed" : "cancelled";
    const result = await ports.store.tryFinalize(userId, {
      key,
      status,
      actualDurationSeconds,
      taskTitleSnapshot,
      categorySnapshot,
      at: now,
      cycleOp,
      expectActiveId: active.id,
      requireBreak: mode === "skip",
    });
    if (result.ok) return toPublicSession(result.row);
    switch (result.reason) {
      case "KEY_CONFLICT": {
        // Concurrent same-key winner already landed: replay it (exactly
        // once finalize, one cycle bump max — TEST_STRATEGY timer map).
        const replayed = key !== null ? await replayFinalize(userId, key) : null;
        if (replayed) return replayed;
        throw new TimerServiceError(
          "ALREADY_FINALIZED",
          "This interval was already finalized.",
        );
      }
      case "NOT_A_BREAK":
        throw new TimerServiceError(
          "INVALID_TRANSITION",
          "Only a break can be skipped.",
        );
      case "NO_ACTIVE":
        return resolveNoActive(userId, key);
    }
  }

  return {
    async current(userId: string): Promise<{ session: PublicSession | null }> {
      const active = await ports.store.findActive(userId);
      return { session: active ? toPublicSession(active) : null };
    },

    async start(userId: string, input: unknown): Promise<PublicSession> {
      const data = parse(startTimerSchema, input);
      if (await ports.store.findActive(userId)) {
        throw new TimerServiceError(
          "ACTIVE_TIMER_EXISTS",
          "Finish or cancel the current interval before starting another.",
        );
      }
      if (data.taskId !== undefined) {
        const task = await ports.store.findTaskSnapshot(
          userId,
          data.taskId,
        );
        // Leak-free denial (spec §12.2): foreign and missing tasks share
        // one shape with the task routes' NOT_FOUND.
        if (!task) throw new TimerServiceError("NOT_FOUND", "Not found.");
        if (task.status !== "active" || task.deletedAt !== null) {
          throw new TimerServiceError(
            "VALIDATION_ERROR",
            "Select an active task for the next focus interval.",
            { taskId: ["Select an active task for the next focus interval."] },
          );
        }
      }
      const durations = await ports.store.getDurations(userId);
      const plannedDurationSeconds = plannedFor(data.intervalType, durations);
      const startedAt = ports.now();
      const expectedEndAt = new Date(
        startedAt.getTime() + plannedDurationSeconds * 1000,
      );
      try {
        const row = await ports.store.createActive({
          userId,
          intervalType: data.intervalType,
          taskId: data.taskId ?? null,
          plannedDurationSeconds,
          startedAt,
          expectedEndAt,
        });
        return toPublicSession(row);
      } catch (error) {
        // Concurrent double-start: the partial unique index arbitrates —
        // the loser surfaces the same 409 as the pre-check (spec §10.6).
        if (error instanceof TimerServiceError) throw error;
        if (isUniqueActiveViolation(error)) {
          throw new TimerServiceError(
            "ACTIVE_TIMER_EXISTS",
            "Finish or cancel the current interval before starting another.",
          );
        }
        throw error;
      }
    },

    async pause(userId: string): Promise<PublicSession> {
      const result = await ports.store.tryPause(userId, ports.now());
      if (result.ok) return toPublicSession(result.row);
      if (result.reason === "NO_ACTIVE") {
        throw new TimerServiceError(
          "NO_ACTIVE_TIMER",
          "No active interval. Start one first.",
        );
      }
      throw new TimerServiceError(
        "INVALID_TRANSITION",
        "Only a running interval can be paused.",
      );
    },

    async resume(userId: string): Promise<PublicSession> {
      const result = await ports.store.tryResume(userId, ports.now());
      if (result.ok) return toPublicSession(result.row);
      if (result.reason === "NO_ACTIVE") {
        throw new TimerServiceError(
          "NO_ACTIVE_TIMER",
          "No active interval. Start one first.",
        );
      }
      throw new TimerServiceError(
        "INVALID_TRANSITION",
        "Only a paused interval can be resumed.",
      );
    },

    async complete(
      userId: string,
      opts: { idempotencyKey?: unknown } = {},
    ): Promise<PublicSession> {
      return finalize(userId, "complete", opts.idempotencyKey ?? null);
    },

    async cancel(
      userId: string,
      opts: { idempotencyKey?: unknown } = {},
    ): Promise<PublicSession> {
      return finalize(userId, "cancel", opts.idempotencyKey ?? null);
    },

    async skipBreak(
      userId: string,
      opts: { idempotencyKey?: unknown } = {},
    ): Promise<PublicSession> {
      return finalize(userId, "skip", opts.idempotencyKey ?? null);
    },
  };
}

export type TimerService = ReturnType<typeof createTimerService>;
