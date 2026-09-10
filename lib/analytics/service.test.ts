import { describe, expect, it } from "vitest";
import {
  createAnalyticsService,
  formatLocalDate,
  getLocalDateParts,
  periodStartUtc,
  type AnalyticsFocusRow,
  type AnalyticsStore,
} from "./service";

/**
 * Seam 2 (unit, hermetic): timezone math, grouping helpers, and summary
 * orchestration over an in-memory fake store — no Prisma, no Next.js.
 * Live-DB coverage of the same contract (DST vectors, date-line, empty
 * state, scoping) lands in
 * app/api/analytics/summary/analytics.integration.test.ts.
 *
 * Every expected number below is a worked literal from spec §8.9, never
 * recomputed from the implementation: 1500s = 25min, 600s = 10min, etc.
 */

const USER = "user-1";
const NOW = new Date("2026-09-10T12:00:00.000Z");

function focusRow(overrides: Partial<AnalyticsFocusRow> = {}): AnalyticsFocusRow {
  return {
    id: crypto.randomUUID(),
    userId: USER,
    taskId: null,
    taskTitleSnapshot: null,
    categorySnapshot: null,
    status: "completed",
    actualDurationSeconds: 1500,
    startedAt: new Date("2026-09-10T10:00:00.000Z"),
    ...overrides,
  };
}

function fakeStore(opts: {
  timezone?: string;
  rows?: AnalyticsFocusRow[];
  completedTasks?: number;
} = {}): AnalyticsStore & {
  calls: { timezoneFor: string[]; list: unknown[]; count: unknown[] };
} {
  const record = {
    timezoneFor: [] as string[],
    list: [] as unknown[],
    count: [] as unknown[],
  };
  return {
    calls: record,
    async getTimezone(userId: string): Promise<string> {
      record.timezoneFor.push(userId);
      return opts.timezone ?? "UTC";
    },
    async listFocusSessions(
      userId: string,
      filter: unknown,
    ): Promise<AnalyticsFocusRow[]> {
      record.list.push({ userId, filter });
      return opts.rows ?? [];
    },
    async countCompletedTasks(userId: string, window: unknown): Promise<number> {
      record.count.push({ userId, window });
      return opts.completedTasks ?? 0;
    },
  } as unknown as AnalyticsStore & {
    calls: { timezoneFor: string[]; list: unknown[]; count: unknown[] };
  };
}

function serviceWith(store: AnalyticsStore) {
  return createAnalyticsService({ now: () => NOW, store });
}

describe("analytics period math (pure timezone helpers)", () => {
  it("resolves Today/7d in UTC", () => {
    expect(periodStartUtc(new Date("2026-01-15T12:00:00.000Z"), "UTC", "today").toISOString()).toBe(
      "2026-01-15T00:00:00.000Z",
    );
    expect(periodStartUtc(new Date("2026-01-15T12:00:00.000Z"), "UTC", "7d").toISOString()).toBe(
      "2026-01-09T00:00:00.000Z",
    );
  });

  it("lands spring-forward Sunday midnight in the pre-transition offset", () => {
    // 2026-03-29 02:00 CET -> 03:00 CEST; midnight itself is still CET (+1).
    expect(
      periodStartUtc(new Date("2026-03-29T12:00:00.000Z"), "Europe/Berlin", "today").toISOString(),
    ).toBe("2026-03-28T23:00:00.000Z");
  });

  it("spans the spring-forward gap by calendar days, not 24h multiples", () => {
    expect(
      periodStartUtc(new Date("2026-03-30T12:00:00.000Z"), "Europe/Berlin", "7d").toISOString(),
    ).toBe("2026-03-23T23:00:00.000Z");
  });

  it("lands fall-back Sunday midnight in the pre-transition offset", () => {
    // 2026-10-25 03:00 CEST -> 02:00 CET; midnight itself is still CEST (+2).
    expect(
      periodStartUtc(new Date("2026-10-25T12:00:00.000Z"), "Europe/Berlin", "today").toISOString(),
    ).toBe("2026-10-24T22:00:00.000Z");
  });

  it("spans the fall-back overlap by calendar days, not 24h multiples", () => {
    expect(
      periodStartUtc(new Date("2026-10-26T12:00:00.000Z"), "Europe/Berlin", "7d").toISOString(),
    ).toBe("2026-10-19T22:00:00.000Z");
  });

  it("formats local calendar dates for daily buckets", () => {
    expect(formatLocalDate(getLocalDateParts(new Date("2026-09-09T22:30:00.000Z"), "Europe/Berlin"))).toBe(
      "2026-09-10",
    );
    expect(formatLocalDate(getLocalDateParts(new Date("2026-09-09T22:30:00.000Z"), "UTC"))).toBe(
      "2026-09-09",
    );
  });

  it("falls back to UTC on an invalid zone instead of throwing", () => {
    expect(periodStartUtc(NOW, "Not/AZone", "today").toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });
});

describe("analytics summary orchestration", () => {
  it("counts a 25-minute completion as +25 minutes and +1 interval", async () => {
    const store = fakeStore({
      rows: [focusRow({ actualDurationSeconds: 1500 })],
      completedTasks: 0,
    });
    const summary = await serviceWith(store).summary(USER, {});
    expect(summary.totals.completedFocusMinutes).toBe(25);
    expect(summary.totals.completedFocusIntervals).toBe(1);
    expect(summary.totals.cancelledFocusIntervals).toBe(0);
    expect(summary.totals.completionRate).toBe(1);
    expect(summary.totals.averageCompletedSeconds).toBe(1500);
  });

  it("counts cancels in the denominator only, with no minutes", async () => {
    const store = fakeStore({
      rows: [
        focusRow({ actualDurationSeconds: 1500, status: "completed" }),
        focusRow({
          actualDurationSeconds: 600,
          status: "cancelled",
          startedAt: new Date("2026-09-10T09:00:00.000Z"),
        }),
      ],
      completedTasks: 0,
    });
    const summary = await serviceWith(store).summary(USER, {});
    expect(summary.totals.completedFocusMinutes).toBe(25);
    expect(summary.totals.completedFocusIntervals).toBe(1);
    expect(summary.totals.cancelledFocusIntervals).toBe(1);
    expect(summary.totals.completionRate).toBe(0.5);
    // Cancelled sessions never surface in daily bars or breakdowns.
    expect(summary.daily.find((d) => d.date === "2026-09-10")).toMatchObject({
      minutes: 25,
      intervals: 1,
    });
    expect(summary.byTask).toHaveLength(1);
  });

  it("returns an empty-state aggregate with null rate and average", async () => {
    const store = fakeStore({ rows: [], completedTasks: 0 });
    const summary = await serviceWith(store).summary(USER, {});
    expect(summary.period).toBe("7d");
    expect(summary.timezone).toBe("UTC");
    expect(summary.totals).toEqual({
      completedFocusMinutes: 0,
      completedFocusIntervals: 0,
      cancelledFocusIntervals: 0,
      completedTasks: 0,
      completionRate: null,
      averageCompletedSeconds: null,
    });
    expect(summary.daily).toHaveLength(7);
    expect(summary.daily.every((d) => d.minutes === 0 && d.intervals === 0)).toBe(true);
    expect(summary.byTask).toEqual([]);
    expect(summary.byCategory).toEqual([]);
  });

  it("buckets daily bars by local calendar day, not UTC day", async () => {
    const store = fakeStore({
      timezone: "Europe/Berlin",
      // Sep 09 22:30Z = Sep 10 00:30 Berlin (today); Sep 09 21:30Z = Sep 09 23:30 Berlin.
      rows: [
        focusRow({ startedAt: new Date("2026-09-09T22:30:00.000Z"), actualDurationSeconds: 1500 }),
        focusRow({ startedAt: new Date("2026-09-09T21:30:00.000Z"), actualDurationSeconds: 600 }),
      ],
    });
    const summary = await serviceWith(store).summary(USER, { period: "today" });
    expect(summary.period).toBe("today");
    expect(summary.timezone).toBe("Europe/Berlin");
    expect(summary.daily).toHaveLength(1);
    expect(summary.daily[0]).toMatchObject({ date: "2026-09-10", minutes: 25, intervals: 1 });
  });

  it("emits seven ascending daily buckets with zero-filled gaps", async () => {
    const store = fakeStore({
      rows: [focusRow({ startedAt: new Date("2026-09-10T10:00:00.000Z"), actualDurationSeconds: 1500 })],
    });
    const summary = await serviceWith(store).summary(USER, { period: "7d" });
    expect(summary.daily.map((d) => d.date)).toEqual([
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
    ]);
    expect(summary.daily[6]).toMatchObject({ minutes: 25, intervals: 1 });
    expect(summary.daily.slice(0, 6).every((d) => d.minutes === 0)).toBe(true);
  });

  it("groups minutes by task and category, ranked, snapshots already resolved", async () => {
    const taskA = crypto.randomUUID();
    const taskB = crypto.randomUUID();
    const store = fakeStore({
      rows: [
        focusRow({ taskId: taskA, taskTitleSnapshot: "Write notes", categorySnapshot: "Writing", actualDurationSeconds: 1500 }),
        focusRow({
          taskId: taskA,
          taskTitleSnapshot: "Write notes",
          categorySnapshot: "Writing",
          actualDurationSeconds: 1500,
          startedAt: new Date("2026-09-09T10:00:00.000Z"),
        }),
        focusRow({ taskId: taskB, taskTitleSnapshot: "Review PRs", categorySnapshot: "Work", actualDurationSeconds: 600 }),
        // Deleted-task legibility rides the stored snapshot: the row keeps
        // its title even though the live task is gone (store resolved it).
        focusRow({ taskId: taskB, taskTitleSnapshot: "Review PRs", categorySnapshot: "Work", actualDurationSeconds: 300 }),
        focusRow({ taskId: null, taskTitleSnapshot: null, categorySnapshot: null, actualDurationSeconds: 300 }),
      ],
      completedTasks: 3,
    });
    const summary = await serviceWith(store).summary(USER, {});
    expect(summary.totals.completedFocusMinutes).toBe(25 + 25 + 10 + 5 + 5);
    expect(summary.totals.completedTasks).toBe(3);
    expect(summary.byTask[0]).toMatchObject({ taskId: taskA, title: "Write notes", minutes: 50, intervals: 2 });
    expect(summary.byTask.find((r) => r.taskId === null)).toMatchObject({
      title: null,
      minutes: 5,
      intervals: 1,
    });
    expect(summary.byCategory[0]).toMatchObject({ category: "Writing", minutes: 50, intervals: 2 });
    expect(summary.byCategory.find((r) => r.category === null)).toMatchObject({
      minutes: 5,
      intervals: 1,
    });
  });

  it("averages completed durations and never mutates the source rows", async () => {
    const rows = [
      focusRow({ actualDurationSeconds: 1500 }),
      focusRow({ actualDurationSeconds: 600, startedAt: new Date("2026-09-09T10:00:00.000Z") }),
    ];
    const before = rows.map((r) => r.startedAt.toISOString());
    const store = fakeStore({ rows });
    const summary = await serviceWith(store).summary(USER, {});
    expect(summary.totals.averageCompletedSeconds).toBe(1050);
    expect(rows.map((r) => r.startedAt.toISOString())).toEqual(before);
  });

  it("scopes every store call to the session user and closes the window at now", async () => {
    const store = fakeStore({ rows: [] });
    const summary = await serviceWith(store).summary(USER, {});
    expect(store.calls.timezoneFor).toEqual([USER]);
    expect(store.calls.list).toHaveLength(1);
    const list = store.calls.list[0] as { userId: string; filter: { from: Date; to: Date } };
    expect(list.userId).toBe(USER);
    expect(list.filter.from.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    expect(list.filter.to).toEqual(NOW);
    expect(summary.window).toEqual({ from: "2026-09-04T00:00:00.000Z", to: NOW.toISOString() });
    expect(store.calls.count).toHaveLength(1);
  });

  it("rejects unknown periods as 400s with a field map", async () => {
    const store = fakeStore({ rows: [] });
    try {
      await serviceWith(store).summary(USER, { period: "30d" });
      expect.unreachable("bad period should reject");
    } catch (error) {
      const { AnalyticsServiceError } = await import("./service");
      expect(error).toBeInstanceOf(AnalyticsServiceError);
      expect((error as InstanceType<typeof AnalyticsServiceError>).code).toBe("VALIDATION_ERROR");
    }
    expect(store.calls.list).toHaveLength(0);
  });
});
