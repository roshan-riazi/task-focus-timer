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

export type FinalizeMode = "complete" | "cancel" | "skip";

export interface TimerSettings {
  focusDurationSeconds: number;
  shortBreakSeconds: number;
  longBreakSeconds: number;
  intervalsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
}

/**
 * Saved-settings defaults (spec §10.2 + §6): row-less users (pre-04 shape)
 * start from these instead of failing — GET /api/settings bootstraps the
 * persisted row separately.
 */
export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  focusDurationSeconds: 1500,
  shortBreakSeconds: 300,
  longBreakSeconds: 900,
  intervalsBeforeLongBreak: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
};

/** Auto-start context for a finalize write (spec §8.5). Never on cancel. */
export interface FinalizeAutoStart {
  onFocusComplete: boolean;
  onBreakFinalize: boolean;
  focusSeconds: number;
  shortSeconds: number;
  longSeconds: number;
}

export interface CycleInfo {
  completedFocusCount: number;
  intervalsBeforeLongBreak: number;
}

export interface NextProposal {
  intervalType: IntervalType;
}

/**
 * Finalize outcome (issue 11): the finalized row plus what the client
 * should do next. `next` is the break/focus proposal when the user must
 * act (`null` once `autoStarted` already started it); `autoStarted` is
 * non-null only when *this call* created the next interval — idempotent
 * replays report `null` so the completion is announced exactly once.
 */
export interface FinalizeResult {
  session: PublicSession;
  autoStarted: PublicSession | null;
  cycle: CycleInfo;
  next: NextProposal | null;
}

/**
 * Lazy-reconcile outcome for `current` (spec §8.4): exactly one of
 * `session` (still active), `reconciled` (auto-completed by this call),
 * or `pendingConfirmation` (expired past the grace window — finalize only
 * via explicit complete = Complete / cancel = Discard) is populated
 * alongside the always-present `cycle` standing count.
 */
export interface CurrentResult {
  session: PublicSession | null;
  reconciled: PublicSession | null;
  pendingConfirmation: {
    session: PublicSession;
    overdueSeconds: number;
  } | null;
  autoStarted: PublicSession | null;
  cycle: CycleInfo;
  next: NextProposal | null;
}

/**
 * Lazy-reconcile grace window (spec §8.4, decision 02): a running interval
 * that expired while the app was closed auto-finalizes as completed when
 * the user returns within 60 minutes past `expected_end_at`; beyond that
 * the client must confirm (Complete/Discard) and the server finalizes only
 * on that explicit action. Paused intervals never expire — paused time is
 * frozen and excluded from expiry math.
 */
export const RECONCILE_GRACE_SECONDS = 3600;

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
  getTimerSettings(userId: string): Promise<TimerSettings>;
  getCycleCount(userId: string): Promise<number>;
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
  /**
   * One transaction (spec §10.6): the status flip, snapshot write,
   * idempotency-key insert, focus-cycle update, and any auto-started next
   * interval land atomically. Duration math and the cycle verdict are
   * computed from the row as read *inside* the write — the caller passes
   * `mode` + `at`, never a precomputed `actual` — so a concurrent
   * pause/resume between the service's read and this write cannot skew the
   * recorded minutes or the increment (issue 11 hardening).
   */
  tryFinalize(
    userId: string,
    input: {
      key: string | null;
      mode: FinalizeMode;
      at: Date;
      taskTitleSnapshot: string | null;
      categorySnapshot: string | null;
      intervalsBeforeLongBreak: number;
      autoStart: FinalizeAutoStart | null;
      /** Optimistic guard: finalize only this row when provided. */
      expectActiveId?: string;
      /** Skip-break may only finalize a break, never a focus interval. */
      requireBreak?: boolean;
    },
  ): Promise<
    | {
        ok: true;
        row: TimerRow;
        cycleCount: number;
        autoStarted: TimerRow | null;
      }
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

/**
 * Break proposal (spec §8.5): after the configured number of completed
 * focus intervals the next proposed break is long, otherwise short.
 * `completedFocusCount` is the post-finalize count — only full-expiry
 * focus completions increment it, so complete-early never flips a short
 * proposal to long by itself.
 */
export function nextBreakFor(
  completedFocusCount: number,
  intervalsBeforeLongBreak: number,
): "short_break" | "long_break" {
  if (completedFocusCount <= 0) return "short_break";
  return completedFocusCount % intervalsBeforeLongBreak === 0
    ? "long_break"
    : "short_break";
}

/**
 * Next-interval proposal after a finalization (spec §8.5): a completed
 * focus proposes the break matching the post-finalize count; a cancelled
 * focus (incl. Discard) proposes a retry; any break finalization hands
 * back to focus. Top-level + exported so the Prisma store shares the exact
 * rule inside its finalize transaction (auto-start creation) instead of
 * restating the switch.
 */
export function proposalForInterval(
  intervalType: IntervalType,
  status: SessionStatus,
  cycleCount: number,
  intervalsBeforeLongBreak: number,
): IntervalType {
  if (intervalType === "focus" && status === "completed") {
    return nextBreakFor(cycleCount, intervalsBeforeLongBreak);
  }
  return "focus";
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

  async function replaySession(
    userId: string,
    key: string,
  ): Promise<TimerRow | null> {
    const record = await ports.store.findIdempotency(userId, key);
    if (!record) return null;
    return ports.store.findSessionById(userId, record.sessionId);
  }

  /**
   * What the client should start next after a finalization (spec §8.5):
   * a completed focus proposes the break matching the post-finalize
   * count; a cancelled focus (incl. Discard) proposes a retry; any break
   * finalization hands back to focus.
   */
  function proposalFor(
    row: TimerRow,
    cycleCount: number,
    intervalsBeforeLongBreak: number,
  ): IntervalType {
    return proposalForInterval(
      row.intervalType,
      row.status,
      cycleCount,
      intervalsBeforeLongBreak,
    );
  }

  function finalizeEnvelope(
    row: TimerRow,
    autoStarted: TimerRow | null,
    cycleCount: number,
    intervalsBeforeLongBreak: number,
  ): FinalizeResult {
    const proposal = proposalFor(row, cycleCount, intervalsBeforeLongBreak);
    return {
      session: toPublicSession(row),
      autoStarted: autoStarted ? toPublicSession(autoStarted) : null,
      cycle: { completedFocusCount: cycleCount, intervalsBeforeLongBreak },
      // Once the next interval is running there is nothing left to propose.
      next: autoStarted ? null : { intervalType: proposal },
    };
  }

  /** Idle proposal for `current`: re-derive the break nudge from the latest
   * finalized row so a refresh after completion (auto-start off) keeps the
   * proposal the finalize call delivered. */
  function idleProposal(
    latest: TimerRow | null,
    cycleCount: number,
    intervalsBeforeLongBreak: number,
  ): NextProposal {
    if (
      latest &&
      latest.intervalType === "focus" &&
      latest.status === "completed"
    ) {
      return {
        intervalType: nextBreakFor(cycleCount, intervalsBeforeLongBreak),
      };
    }
    return { intervalType: "focus" };
  }

  async function snapshotsFor(
    userId: string,
    taskId: string | null,
  ): Promise<{ taskTitleSnapshot: string | null; categorySnapshot: string | null }> {
    if (!taskId) return { taskTitleSnapshot: null, categorySnapshot: null };
    // Resilience over strictness: a task that vanished mid-interval
    // must not block finalization — snapshots fall back to null and
    // history still records the interval.
    const task = await ports.store.findTaskSnapshot(userId, taskId);
    if (!task) return { taskTitleSnapshot: null, categorySnapshot: null };
    return { taskTitleSnapshot: task.title, categorySnapshot: task.category };
  }

  function autoStartFor(
    mode: FinalizeMode,
    settings: TimerSettings,
  ): FinalizeAutoStart | null {
    // An explicit abort (cancel, incl. Discard from the expired-confirm
    // dialog) never auto-starts — the user just asked to stop.
    if (mode === "cancel") return null;
    return {
      onFocusComplete: settings.autoStartBreaks,
      onBreakFinalize: settings.autoStartFocus,
      focusSeconds: settings.focusDurationSeconds,
      shortSeconds: settings.shortBreakSeconds,
      longSeconds: settings.longBreakSeconds,
    };
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
  ): Promise<FinalizeResult> {
    if (key !== null) {
      const replayed = await replaySession(userId, key);
      if (replayed) {
        const settings = await ports.store.getTimerSettings(userId);
        const cycleCount = await ports.store.getCycleCount(userId);
        return finalizeEnvelope(
          replayed,
          null,
          cycleCount,
          settings.intervalsBeforeLongBreak,
        );
      }
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
    mode: FinalizeMode,
    rawKey: unknown,
  ): Promise<FinalizeResult> {
    const key = parseIdempotencyKey(rawKey);
    const now = ports.now();

    // Fast-path replay: same key twice returns the original outcome
    // without touching the cycle count (SYSTEM_DESIGN §6).
    if (key !== null) {
      const replayed = await replaySession(userId, key);
      if (replayed) {
        const settings = await ports.store.getTimerSettings(userId);
        const cycleCount = await ports.store.getCycleCount(userId);
        return finalizeEnvelope(
          replayed,
          null,
          cycleCount,
          settings.intervalsBeforeLongBreak,
        );
      }
    }

    const active = await ports.store.findActive(userId);
    if (!active) return resolveNoActive(userId, key);
    if (mode === "skip" && active.intervalType === "focus") {
      throw new TimerServiceError(
        "INVALID_TRANSITION",
        "Only a break can be skipped.",
      );
    }

    const settings = await ports.store.getTimerSettings(userId);
    const snapshots = await snapshotsFor(userId, active.taskId);

    const result = await ports.store.tryFinalize(userId, {
      key,
      mode,
      at: now,
      taskTitleSnapshot: snapshots.taskTitleSnapshot,
      categorySnapshot: snapshots.categorySnapshot,
      intervalsBeforeLongBreak: settings.intervalsBeforeLongBreak,
      autoStart: autoStartFor(mode, settings),
      expectActiveId: active.id,
      requireBreak: mode === "skip",
    });
    if (result.ok) {
      return finalizeEnvelope(
        result.row,
        result.autoStarted,
        result.cycleCount,
        settings.intervalsBeforeLongBreak,
      );
    }
    switch (result.reason) {
      case "KEY_CONFLICT": {
        // Concurrent same-key winner already landed: replay it (exactly
        // once finalize, one cycle bump max — TEST_STRATEGY timer map).
        if (key !== null) {
          const replayed = await replaySession(userId, key);
          if (replayed) {
            const cycleCount = await ports.store.getCycleCount(userId);
            return finalizeEnvelope(
              replayed,
              null,
              cycleCount,
              settings.intervalsBeforeLongBreak,
            );
          }
        }
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
    async current(userId: string): Promise<CurrentResult> {
      const now = ports.now();
      const settings = await ports.store.getTimerSettings(userId);
      const threshold = settings.intervalsBeforeLongBreak;
      const count = await ports.store.getCycleCount(userId);
      const cycle: CycleInfo = {
        completedFocusCount: count,
        intervalsBeforeLongBreak: threshold,
      };

      const active = await ports.store.findActive(userId);
      if (!active) {
        const latest = await ports.store.findLatest(userId);
        return {
          session: null,
          reconciled: null,
          pendingConfirmation: null,
          autoStarted: null,
          cycle,
          next: idleProposal(latest, count, threshold),
        };
      }
      // Paused time is frozen (SYSTEM_DESIGN §4): a paused interval never
      // expires no matter how long it sits, and a running interval that
      // has not reached its expected end needs no reconciliation.
      if (active.status === "paused" || now.getTime() < active.expectedEndAt.getTime()) {
        return {
          session: toPublicSession(active),
          reconciled: null,
          pendingConfirmation: null,
          autoStarted: null,
          cycle,
          next: null,
        };
      }

      const overdueMs = now.getTime() - active.expectedEndAt.getTime();
      if (overdueMs > RECONCILE_GRACE_SECONDS * 1000) {
        // Beyond the grace window the server must NOT finalize: the client
        // shows the Complete/Discard confirm dialog (prototype
        // workspace.html) and finalizes only via explicit complete/cancel.
        const session = toPublicSession(active);
        return {
          session,
          reconciled: null,
          pendingConfirmation: {
            session,
            overdueSeconds: Math.floor(overdueMs / 1000),
          },
          autoStarted: null,
          cycle,
          next: null,
        };
      }

      // Within the grace window: lazy auto-finalize as completed exactly
      // once (spec §8.4). The server owns the key (`reconcile:<id>`) so
      // concurrent `current` calls arbitrate through the same idempotency
      // path as client double-submits; the losers replay the winner.
      const key = `reconcile:${active.id}`;
      const snapshots = await snapshotsFor(userId, active.taskId);
      const result = await ports.store.tryFinalize(userId, {
        key,
        mode: "complete",
        at: now,
        taskTitleSnapshot: snapshots.taskTitleSnapshot,
        categorySnapshot: snapshots.categorySnapshot,
        intervalsBeforeLongBreak: threshold,
        autoStart: autoStartFor("complete", settings),
        expectActiveId: active.id,
      });
      if (result.ok) {
        const envelope = finalizeEnvelope(
          result.row,
          result.autoStarted,
          result.cycleCount,
          threshold,
        );
        return {
          session: envelope.autoStarted,
          reconciled: envelope.session,
          pendingConfirmation: null,
          autoStarted: envelope.autoStarted,
          cycle: envelope.cycle,
          next: envelope.next,
        };
      }
      if (result.reason === "KEY_CONFLICT") {
        const winner = await replaySession(userId, key);
        if (winner) {
          const freshCount = await ports.store.getCycleCount(userId);
          const started = await ports.store.findActive(userId);
          const proposal = proposalFor(winner, freshCount, threshold);
          return {
            session: started ? toPublicSession(started) : null,
            reconciled: toPublicSession(winner),
            pendingConfirmation: null,
            // Exactly-once announcement: the sibling call created the
            // interval, so this replay claims no creation. The proposal
            // still travels when nothing is running yet.
            autoStarted: null,
            cycle: {
              completedFocusCount: freshCount,
              intervalsBeforeLongBreak: threshold,
            },
            next: started ? null : { intervalType: proposal },
          };
        }
      }
      // NO_ACTIVE: an explicit finalize won the race between our read and
      // our write — its response carried the announcement, so report the
      // plain post-state. (KEY_CONFLICT with a missing key row cannot
      // happen; the fallback below covers it defensively.)
      const reread = await ports.store.findActive(userId);
      if (!reread) {
        const latest = await ports.store.findLatest(userId);
        const freshCount = await ports.store.getCycleCount(userId);
        return {
          session: null,
          reconciled: null,
          pendingConfirmation: null,
          autoStarted: null,
          cycle: {
            completedFocusCount: freshCount,
            intervalsBeforeLongBreak: threshold,
          },
          next: idleProposal(latest, freshCount, threshold),
        };
      }
      return {
        session: toPublicSession(reread),
        reconciled: null,
        pendingConfirmation: null,
        autoStarted: null,
        cycle,
        next: null,
      };
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
      const durations = await ports.store.getTimerSettings(userId);
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
    ): Promise<FinalizeResult> {
      return finalize(userId, "complete", opts.idempotencyKey ?? null);
    },

    async cancel(
      userId: string,
      opts: { idempotencyKey?: unknown } = {},
    ): Promise<FinalizeResult> {
      return finalize(userId, "cancel", opts.idempotencyKey ?? null);
    },

    async skipBreak(
      userId: string,
      opts: { idempotencyKey?: unknown } = {},
    ): Promise<FinalizeResult> {
      return finalize(userId, "skip", opts.idempotencyKey ?? null);
    },
  };
}

export type TimerService = ReturnType<typeof createTimerService>;
