import { z } from "zod";
import { flattenZodFields } from "../auth/validation";
import {
  analyticsSummaryQuerySchema,
  type AnalyticsPeriod,
} from "./validation";

export type AnalyticsFocusStatus = "completed" | "cancelled";

/**
 * Storage-shaped focus row: the store resolves display snapshots
 * (stored-wins-then-live, null = Unassigned/Uncategorized) next to the
 * query it constrains — the same contract as `lib/sessions/prisma-store`.
 * Breaks and running/paused rows never reach the service; the store's
 * `where` clause owns that invariant.
 */
export interface AnalyticsFocusRow {
  id: string;
  userId: string;
  taskId: string | null;
  taskTitleSnapshot: string | null;
  categorySnapshot: string | null;
  status: AnalyticsFocusStatus;
  actualDurationSeconds: number | null;
  startedAt: Date;
}

export interface AnalyticsDailyBar {
  /** Local calendar date `YYYY-MM-DD` in the user's timezone. */
  date: string;
  minutes: number;
  intervals: number;
}

export interface AnalyticsTaskEntry {
  taskId: string | null;
  /** Null renders as "Unassigned" (spec §8.8); snapshots keep deleted tasks legible. */
  title: string | null;
  minutes: number;
  intervals: number;
}

export interface AnalyticsCategoryEntry {
  /** Null renders as "Uncategorized" in the UI; the API invents no labels. */
  category: string | null;
  minutes: number;
  intervals: number;
}

export interface AnalyticsTotals {
  completedFocusMinutes: number;
  completedFocusIntervals: number;
  cancelledFocusIntervals: number;
  completedTasks: number;
  /** Null when there are no finalized focus intervals (empty-state signal). */
  completionRate: number | null;
  /** Mean actual seconds over completed focus; null when none. */
  averageCompletedSeconds: number | null;
}

export interface AnalyticsSummary {
  period: AnalyticsPeriod;
  timezone: string;
  window: { from: string; to: string };
  totals: AnalyticsTotals;
  /** Ascending oldest → today; zero-filled so the chart always has N bars. */
  daily: AnalyticsDailyBar[];
  /** Ranked minutes desc; cancelled sessions never appear here. */
  byTask: AnalyticsTaskEntry[];
  byCategory: AnalyticsCategoryEntry[];
}

export type AnalyticsErrorCode = "VALIDATION_ERROR";

/**
 * Typed service failure. Routes map codes to HTTP status + envelope
 * (VALIDATION_ERROR → 400 with field map); anything else is a 500.
 * There is no NOT_FOUND: empty analytics is a 200 with zeroed
 * aggregates, and cross-user rows are excluded by scoped store queries
 * — never leaked, never hinted (spec §12.2).
 */
export class AnalyticsServiceError extends Error {
  readonly fields?: Record<string, string[]>;
  constructor(
    readonly code: AnalyticsErrorCode,
    message: string,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AnalyticsServiceError";
    this.fields = fields;
  }
}

/**
 * System boundaries behind the analytics service (health-route factory
 * pattern: callers inject the boundary; unit tests inject the in-memory
 * fake in service.test.ts; routes inject the Prisma store in
 * prisma-store.ts). Every method scopes by `userId` — identity always
 * arrives from the session via the handlers, never from client input
 * (spec §11.5).
 */
export interface AnalyticsStore {
  /** Saved IANA timezone (`users.timezone`); `"UTC"` when the user row is missing. */
  getTimezone(userId: string): Promise<string>;
  /**
   * Finalized focus sessions only (`completed|cancelled`, breaks
   * excluded) with `from <= startedAt <= to` (the window is closed on
   * both ends — "Today" is the local calendar day, never an open-ended
   * tail; future-dated rows never leak in).
   */
  listFocusSessions(
    userId: string,
    window: { from: Date; to: Date },
  ): Promise<AnalyticsFocusRow[]>;
  /**
   * Live tasks whose `completedAt` falls in the window
   * (`deletedAt IS NULL` — deleted tasks stay reportable through session
   * snapshots, not through this count).
   */
  countCompletedTasks(
    userId: string,
    window: { from: Date; to: Date },
  ): Promise<number>;
}

export interface AnalyticsPorts {
  now(): Date;
  store: AnalyticsStore;
}

// ---------------------------------------------------------------------------
// Timezone-aware period math (pure, clock-injected per TEST_STRATEGY §2)
// ---------------------------------------------------------------------------
// Mirror of `lib/sessions/service` rolling-local-days rule (SYSTEM_DESIGN
// §7): calendar subtraction, never N*24h, so DST-spanning windows stay
// exactly N local days wide. Duplicated (not imported) so each lib owns
// its window math next to the query it constrains; the two are pinned
// to identical vectors in their respective service.test.ts files.

export function isValidTimezone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

/** Local calendar date of `date` in `timeZone` (DST-safe: ICU resolves the offset). */
export function getLocalDateParts(date: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  let year = 0;
  let month = 0;
  let day = 0;
  for (const part of formatter.formatToParts(date)) {
    if (part.type === "year") year = Number(part.value);
    else if (part.type === "month") month = Number(part.value);
    else if (part.type === "day") day = Number(part.value);
  }
  return { year, month, day };
}

/** Calendar-day subtraction on date parts (UTC arithmetic on a bare YMD is exact). */
export function subtractLocalDays(parts: LocalDateParts, days: number): LocalDateParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - days * 86_400_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** UTC offset of `timeZone` at the given UTC instant, in milliseconds. */
function timezoneOffsetMs(utcMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  // Some ICU builds format midnight as hour 24 under hour12:false.
  const asUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    (values.hour ?? 0) % 24,
    values.minute ?? 0,
    values.second ?? 0,
  );
  return asUtc - utcMs;
}

/**
 * UTC instant of local midnight opening the given local day in `timeZone`.
 * Iterates wall→UTC convergence (offset depends on the answer) — three
 * passes settle every IANA midnight, including 23/25-hour DST days.
 */
export function zonedDayStartToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = wallAsUtc;
  for (let pass = 0; pass < 3; pass += 1) {
    guess = wallAsUtc - timezoneOffsetMs(guess, timeZone);
  }
  return new Date(guess);
}

/**
 * Rolling-window lower bound (inclusive): Today = local midnight today,
 * 7d = local midnight 6 days ago. Calendar subtraction — never `N * 24h`.
 * Invalid zones fall back to UTC (the column is validated at
 * registration/settings; analytics must never 500 on a legacy value).
 */
export function periodStartUtc(
  now: Date,
  timeZone: string,
  period: AnalyticsPeriod,
): Date {
  const zone = isValidTimezone(timeZone) ? timeZone : "UTC";
  const today = getLocalDateParts(now, zone);
  const daysBack = period === "today" ? 0 : 6;
  const start = subtractLocalDays(today, daysBack);
  return zonedDayStartToUtc(start.year, start.month, start.day, zone);
}

/** `YYYY-MM-DD` label for a local calendar day (daily-bar bucket key). */
export function formatLocalDate(parts: LocalDateParts): string {
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function validationError(error: z.ZodError): AnalyticsServiceError {
  return new AnalyticsServiceError(
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

const UNASSIGNED_KEY = "__unassigned";
const UNCATEGORIZED_KEY = "__uncategorized";

export function createAnalyticsService(ports: AnalyticsPorts) {
  return {
    async summary(userId: string, input: unknown): Promise<AnalyticsSummary> {
      const query = parse(analyticsSummaryQuerySchema, input);
      const now = ports.now();
      const storedTimezone = await ports.store.getTimezone(userId);
      const timezone = isValidTimezone(storedTimezone) ? storedTimezone : "UTC";
      const from = periodStartUtc(now, timezone, query.period);
      const window = { from, to: now };
      const [rows, completedTasks] = await Promise.all([
        ports.store.listFocusSessions(userId, window),
        ports.store.countCompletedTasks(userId, window),
      ]);

      const completed = rows.filter((row) => row.status === "completed");
      const cancelledCount = rows.filter((row) => row.status === "cancelled").length;

      const completedSeconds = completed.map((row) => row.actualDurationSeconds ?? 0);
      const totalSeconds = completedSeconds.reduce((sum, seconds) => sum + seconds, 0);
      const denom = completed.length + cancelledCount;

      // Daily buckets: N ascending local days ending today, zero-filled so
      // the chart always renders N bars (the empty-state signal for issue 16).
      const days = query.period === "today" ? 1 : 7;
      const todayParts = getLocalDateParts(now, timezone);
      const daily: AnalyticsDailyBar[] = [];
      const dailyIndex = new Map<string, AnalyticsDailyBar>();
      for (let position = days - 1; position >= 0; position -= 1) {
        const parts = subtractLocalDays(todayParts, position);
        const entry: AnalyticsDailyBar = {
          date: formatLocalDate(parts),
          minutes: 0,
          intervals: 0,
        };
        daily.push(entry);
        dailyIndex.set(entry.date, entry);
      }

      for (const row of completed) {
        // Grouping reads `startedAt` only — stored UTC stamps are never
        // modified (spec §13.3 DST acceptance).
        const bucket = dailyIndex.get(
          formatLocalDate(getLocalDateParts(row.startedAt, timezone)),
        );
        if (!bucket) continue;
        bucket.minutes += (row.actualDurationSeconds ?? 0) / 60;
        bucket.intervals += 1;
      }

      // By-task: group by stable `taskId` (snapshots keep deleted tasks
      // legible); the newest row's resolved title wins when snapshots
      // disagree across renames. Cancelled sessions never appear here —
      // they contribute to the rate denominator only (spec §8.9).
      const byTaskGroups = new Map<
        string,
        { taskId: string | null; title: string | null; seconds: number; intervals: number; newestAt: number }
      >();
      for (const row of completed) {
        const key = row.taskId ?? UNASSIGNED_KEY;
        const seconds = row.actualDurationSeconds ?? 0;
        const existing = byTaskGroups.get(key);
        if (!existing) {
          byTaskGroups.set(key, {
            taskId: row.taskId,
            title: row.taskTitleSnapshot,
            seconds,
            intervals: 1,
            newestAt: row.startedAt.getTime(),
          });
        } else {
          existing.seconds += seconds;
          existing.intervals += 1;
          if (row.startedAt.getTime() > existing.newestAt) {
            existing.title = row.taskTitleSnapshot;
            existing.newestAt = row.startedAt.getTime();
          }
        }
      }
      const byTask: AnalyticsTaskEntry[] = [...byTaskGroups.values()]
        .map((group) => ({
          taskId: group.taskId,
          title: group.title,
          minutes: group.seconds / 60,
          intervals: group.intervals,
        }))
        .sort((a, b) => {
          if (b.minutes !== a.minutes) return b.minutes - a.minutes;
          if (b.intervals !== a.intervals) return b.intervals - a.intervals;
          if (a.title === null && b.title !== null) return 1;
          if (b.title === null && a.title !== null) return -1;
          const titleOrder = (a.title ?? "").localeCompare(b.title ?? "");
          if (titleOrder !== 0) return titleOrder;
          return (a.taskId ?? "").localeCompare(b.taskId ?? "");
        });

      // By-category: group by resolved category; null stays null (the UI
      // renders "Uncategorized" — the API invents no labels).
      const byCategoryGroups = new Map<
        string,
        { category: string | null; seconds: number; intervals: number }
      >();
      for (const row of completed) {
        const key = row.categorySnapshot ?? UNCATEGORIZED_KEY;
        const seconds = row.actualDurationSeconds ?? 0;
        const existing = byCategoryGroups.get(key);
        if (!existing) {
          byCategoryGroups.set(key, {
            category: row.categorySnapshot,
            seconds,
            intervals: 1,
          });
        } else {
          existing.seconds += seconds;
          existing.intervals += 1;
        }
      }
      const byCategory: AnalyticsCategoryEntry[] = [...byCategoryGroups.values()]
        .map((group) => ({
          category: group.category,
          minutes: group.seconds / 60,
          intervals: group.intervals,
        }))
        .sort((a, b) => {
          if (b.minutes !== a.minutes) return b.minutes - a.minutes;
          if (b.intervals !== a.intervals) return b.intervals - a.intervals;
          if (a.category === null && b.category !== null) return 1;
          if (b.category === null && a.category !== null) return -1;
          return (a.category ?? "").localeCompare(b.category ?? "");
        });

      const nonNullSeconds = completed
        .map((row) => row.actualDurationSeconds)
        .filter((seconds): seconds is number => typeof seconds === "number");

      return {
        period: query.period,
        timezone,
        window: { from: from.toISOString(), to: now.toISOString() },
        totals: {
          completedFocusMinutes: totalSeconds / 60,
          completedFocusIntervals: completed.length,
          cancelledFocusIntervals: cancelledCount,
          completedTasks,
          completionRate: denom === 0 ? null : completed.length / denom,
          averageCompletedSeconds:
            nonNullSeconds.length === 0
              ? null
              : nonNullSeconds.reduce((sum, seconds) => sum + seconds, 0) / nonNullSeconds.length,
        },
        daily,
        byTask,
        byCategory,
      };
    },
  };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
