import { z } from "zod";
import { flattenZodFields } from "../auth/validation";
import {
  listSessionsQuerySchema,
  type HistoryPeriod,
} from "./validation";

export type HistoryIntervalType = "focus" | "short_break" | "long_break";

export type HistoryStatus = "completed" | "cancelled";

/** Storage-shaped row (Dates in, ISO strings out via `toPublicHistorySession`). */
export interface HistoryRow {
  id: string;
  userId: string;
  taskId: string | null;
  /** Resolved display snapshot: stored snapshot wins, live task is the fallback (see prisma-store). */
  taskTitleSnapshot: string | null;
  categorySnapshot: string | null;
  intervalType: HistoryIntervalType;
  status: HistoryStatus;
  plannedDurationSeconds: number;
  actualDurationSeconds: number | null;
  startedAt: Date;
  expectedEndAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

export interface PublicHistorySession {
  id: string;
  taskId: string | null;
  /** Null renders as "Unassigned" (spec §8.8); non-null stays legible after task deletion. */
  taskTitleSnapshot: string | null;
  categorySnapshot: string | null;
  intervalType: HistoryIntervalType;
  status: HistoryStatus;
  plannedDurationSeconds: number;
  actualDurationSeconds: number | null;
  startedAt: string;
  expectedEndAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
}

export function toPublicHistorySession(row: HistoryRow): PublicHistorySession {
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
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}

export type HistoryErrorCode = "VALIDATION_ERROR";

/**
 * Typed service failure. Routes map codes to HTTP status + envelope
 * (VALIDATION_ERROR → 400 with field map); anything else is a 500.
 * There is no NOT_FOUND: an empty history is a 200 with zero rows, and
 * cross-user rows are excluded by the scoped store query — never leaked,
 * never hinted (spec §12.2).
 */
export class HistoryServiceError extends Error {
  readonly fields?: Record<string, string[]>;
  constructor(
    readonly code: HistoryErrorCode,
    message: string,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "HistoryServiceError";
    this.fields = fields;
  }
}

/**
 * System boundaries behind the history service (health-route factory
 * pattern: callers inject the boundary; unit tests inject the in-memory
 * fake in service.test.ts; routes inject the Prisma store in
 * prisma-store.ts). Every method scopes by `userId` — identity always
 * arrives from the session via the handlers, never from client input
 * (spec §11.5).
 *
 * Status filtering (finalized only) lives in the store's `where` clause,
 * not here: the service owns period math, cursor pagination, and the type
 * filter, while the store owns the `completed|cancelled` invariant next to
 * the query it constrains.
 */
export interface HistoryStore {
  /** Saved IANA timezone (`users.timezone`); `"UTC"` when the user row is missing. */
  getTimezone(userId: string): Promise<string>;
  /**
   * Reverse-chron keyset page over `(startedAt, id)`: rows are ordered
   * `startedAt DESC, id DESC`, filtered to `from <= startedAt <= to`
   * (the window is closed on both ends — "Today" is the local calendar
   * day, never an open-ended tail), and — when `cursor` is present —
   * strictly below it. `take` is the over-fetch (`limit + 1`); the
   * service derives `nextCursor` from the overflow.
   */
  listSessions(
    userId: string,
    filter: {
      from: Date;
      to: Date;
      intervalTypes: HistoryIntervalType[] | null;
      cursor?: { startedAt: Date; id: string };
      take: number;
    },
  ): Promise<HistoryRow[]>;
}

export interface HistoryPorts {
  now(): Date;
  store: HistoryStore;
}

// ---------------------------------------------------------------------------
// Timezone-aware period math (pure, clock-injected per TEST_STRATEGY §2)
// ---------------------------------------------------------------------------

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
 * passes settle every IANA midnight, including 23/25-hour DST days, because
 * midnight itself is never inside the transition gap except in zones whose
 * transitions land exactly at 00:00 (there the third pass absorbs the hop).
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
 * 7d = local midnight 6 days ago, 30d = local midnight 29 days ago
 * (SYSTEM_DESIGN §7 rolling-local-days rule, extended to 30d per spec
 * §8.8). Calendar subtraction — never `N * 24h` — so windows spanning a
 * DST transition stay exactly N local days wide. Invalid zones fall back
 * to UTC (the column is validated at registration/settings; history must
 * never 500 on a legacy value).
 */
export function periodStartUtc(
  now: Date,
  timeZone: string,
  period: HistoryPeriod,
): Date {
  const zone = isValidTimezone(timeZone) ? timeZone : "UTC";
  const today = getLocalDateParts(now, zone);
  const daysBack = period === "today" ? 0 : period === "7d" ? 6 : 29;
  const start = subtractLocalDays(today, daysBack);
  return zonedDayStartToUtc(start.year, start.month, start.day, zone);
}

// ---------------------------------------------------------------------------
// Cursor pagination (opaque base64url over `(startedAt, id)`)
// ---------------------------------------------------------------------------

const cursorIdSchema = z.string().uuid();

/**
 * Opaque page token over `(startedAt, id)` — the list order
 * (SYSTEM_DESIGN §6). Base64url JSON carries no session content
 * (timestamp + uuid only), so it is safe to log; anything unforgable
 * decodes to a 400, never a 500.
 */
export function encodeCursor(cursor: { startedAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ s: cursor.startedAt.toISOString(), i: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeCursor(token: string): { startedAt: Date; id: string } {
  try {
    const raw = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as unknown;
    if (typeof raw !== "object" || raw === null || !("s" in raw) || !("i" in raw)) {
      throw new Error("bad cursor shape");
    }
    const { s, i } = raw as { s: unknown; i: unknown };
    if (typeof s !== "string" || typeof i !== "string") {
      throw new Error("bad cursor fields");
    }
    const startedAt = new Date(s);
    if (Number.isNaN(startedAt.getTime())) throw new Error("bad cursor time");
    cursorIdSchema.parse(i);
    return { startedAt, id: i };
  } catch (error) {
    if (error instanceof HistoryServiceError) throw error;
    throw new HistoryServiceError("VALIDATION_ERROR", "This page has expired.", {
      cursor: ["This page has expired. Start from the first page."],
    });
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

function validationError(error: z.ZodError): HistoryServiceError {
  return new HistoryServiceError(
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

export function createHistoryService(ports: HistoryPorts) {
  return {
    async list(
      userId: string,
      input: unknown,
    ): Promise<{ sessions: PublicHistorySession[]; nextCursor: string | null }> {
      const query = parse(listSessionsQuerySchema, input);
      // Decode before touching the store: forged cursors fail without a query.
      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
      const now = ports.now();
      const from = periodStartUtc(now, await ports.store.getTimezone(userId), query.period);
      const rows = await ports.store.listSessions(userId, {
        from,
        to: now,
        intervalTypes: query.type === "focus" ? ["focus"] : null,
        ...(cursor ? { cursor } : {}),
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const nextCursor =
        rows.length > query.limit
          ? encodeCursor({
              startedAt: page[page.length - 1].startedAt,
              id: page[page.length - 1].id,
            })
          : null;
      return { sessions: page.map(toPublicHistorySession), nextCursor };
    },
  };
}

export type HistoryService = ReturnType<typeof createHistoryService>;
