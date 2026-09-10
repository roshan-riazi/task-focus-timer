import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createAnalyticsSummaryHandler,
  type AnalyticsHandlerDeps,
} from "@/lib/analytics/handlers";
import { createPrismaAnalyticsStore } from "@/lib/analytics/prisma-store";
import {
  createAnalyticsService,
  type AnalyticsService,
  type AnalyticsSummary,
} from "@/lib/analytics/service";
import { createPrismaTaskStore } from "@/lib/tasks/prisma-store";
import type { AppSession } from "@/lib/auth/session";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

const APP_URL = "http://localhost:3000";
// Fixed clock for the core acceptance vectors (mirrors the history suite).
const NOW = new Date("2026-09-10T12:00:00.000Z");

/**
 * Issue 15 acceptance against live Postgres (TEST_STRATEGY §2, API level):
 *
 * - 25-min completion → +25 minutes / +1 interval; cancel → denominator
 *   only with zero minutes and no daily/by-task surface.
 * - Breaks and running/paused rows never contribute; future-dated rows
 *   belong to no window yet (range closed at now).
 * - Non-UTC grouping: the same instants bucket differently in Berlin vs
 *   UTC (local calendar days, never UTC days).
 * - DST vectors: Europe/Berlin spring-forward + fall-back Sundays group
 *   by calendar days (never N*24h) with stored UTC stamps untouched.
 * - Date-line vector: Pacific/Kiritimati (UTC+14) resolves the local day
 *   past the line.
 * - Completed tasks count from `completed_at` in the window; deleted-task
 *   sessions stay reportable via snapshots; by-task/by-category rank
 *   minutes desc with averages.
 * - Empty state: zeroed aggregates with null rate/average and zero-filled
 *   daily bars. Per-user scoping both directions; signed-out reads as
 *   401; bad periods fail as 400s, never 500s.
 */
describeIfDb(
  "analytics API (live Postgres)",
  () => {
    let db: PrismaClient;
    const createdUserIds: string[] = [];

    async function setup(): Promise<void> {
      const mod = await import("@/lib/db");
      db = mod.db;
    }

    function serviceAt(now: Date): AnalyticsService {
      return createAnalyticsService({
        now: () => now,
        store: createPrismaAnalyticsStore(db),
      });
    }

    function email(prefix: string): string {
      return `${prefix}-${crypto.randomUUID()}@example.com`;
    }

    async function makeUser(
      prefix: string,
      timezone = "UTC",
    ): Promise<{ id: string; email: string }> {
      const address = email(prefix);
      const user = await db.user.create({ data: { email: address, timezone } });
      createdUserIds.push(user.id);
      return { id: user.id, email: address };
    }

    function depsFor(
      userId: string,
      userEmail: string,
      service: AnalyticsService,
    ): AnalyticsHandlerDeps {
      const session: AppSession = {
        user: { id: userId, email: userEmail, emailVerified: null, timezone: "UTC" },
        expires: new Date("2026-10-09T12:00:00.000Z").toISOString(),
      };
      return {
        getService: async () => service,
        getSession: async () => session,
      };
    }

    async function seedSession(data: {
      userId: string;
      taskId?: string | null;
      taskTitleSnapshot?: string | null;
      categorySnapshot?: string | null;
      intervalType?: "focus" | "short_break" | "long_break";
      status?: "running" | "paused" | "completed" | "cancelled";
      startedAt: Date;
      actualDurationSeconds?: number | null;
    }): Promise<{ id: string; startedAt: Date }> {
      const startedAt = data.startedAt;
      const status = data.status ?? "completed";
      const row = await db.timerSession.create({
        data: {
          userId: data.userId,
          taskId: data.taskId ?? null,
          taskTitleSnapshot: data.taskTitleSnapshot ?? null,
          categorySnapshot: data.categorySnapshot ?? null,
          intervalType: data.intervalType ?? "focus",
          status,
          plannedDurationSeconds: 1500,
          actualDurationSeconds:
            data.actualDurationSeconds !== undefined
              ? data.actualDurationSeconds
              : status === "completed" || status === "cancelled"
                ? 1500
                : null,
          startedAt,
          expectedEndAt: new Date(startedAt.getTime() + 1500_000),
          ...(status === "completed"
            ? { completedAt: new Date(startedAt.getTime() + 1500_000) }
            : {}),
          ...(status === "cancelled"
            ? { cancelledAt: new Date(startedAt.getTime() + 600_000) }
            : {}),
        },
        select: { id: true, startedAt: true },
      });
      return row;
    }

    async function get(
      deps: AnalyticsHandlerDeps,
      query = "",
    ): Promise<{ status: number; body: AnalyticsSummary }> {
      const res = await createAnalyticsSummaryHandler(deps)(
        new Request(`${APP_URL}/api/analytics/summary${query}`, { method: "GET" }),
      );
      return { status: res.status, body: (await res.json()) as AnalyticsSummary };
    }

    afterEach(async () => {
      if (db) {
        // Users cascade to tasks, sessions, settings, and cycle state.
        await db.user.deleteMany({
          where: { id: { in: createdUserIds.splice(0) } },
        });
      }
    });

    it("counts a 25-minute completion and ignores breaks, active, and future rows", async () => {
      await setup();
      const service = serviceAt(NOW);
      const user = await makeUser("analytics-basic");
      const deps = depsFor(user.id, user.email, service);

      await seedSession({
        userId: user.id,
        intervalType: "focus",
        status: "completed",
        startedAt: new Date("2026-09-10T10:00:00.000Z"),
        actualDurationSeconds: 1500,
        taskTitleSnapshot: "Write report",
        categorySnapshot: "work",
      });
      await seedSession({
        userId: user.id,
        intervalType: "short_break",
        status: "completed",
        startedAt: new Date("2026-09-10T09:00:00.000Z"),
        actualDurationSeconds: 300,
      });
      await seedSession({
        userId: user.id,
        intervalType: "focus",
        status: "running",
        startedAt: new Date("2026-09-10T11:00:00.000Z"),
        actualDurationSeconds: null,
      });
      // A paused row would violate the one-active-per-user constraint on
      // the same user, so it lives on another user (same exclusion rule).
      const otherActive = await makeUser("analytics-basic-paused");
      await seedSession({
        userId: otherActive.id,
        intervalType: "focus",
        status: "paused",
        startedAt: new Date("2026-09-10T08:00:00.000Z"),
        actualDurationSeconds: null,
      });
      // Future-dated rows belong to no window yet (the range is closed at now).
      await seedSession({
        userId: user.id,
        intervalType: "focus",
        status: "completed",
        startedAt: new Date("2026-09-11T10:00:00.000Z"),
        actualDurationSeconds: 1500,
      });

      const { status, body } = await get(deps, "?period=today");
      expect(status).toBe(200);
      expect(body.period).toBe("today");
      expect(body.timezone).toBe("UTC");
      expect(body.window).toEqual({
        from: "2026-09-10T00:00:00.000Z",
        to: NOW.toISOString(),
      });
      expect(body.totals).toMatchObject({
        completedFocusMinutes: 25,
        completedFocusIntervals: 1,
        cancelledFocusIntervals: 0,
        completedTasks: 0,
        completionRate: 1,
        averageCompletedSeconds: 1500,
      });
      expect(body.daily).toEqual([{ date: "2026-09-10", minutes: 25, intervals: 1 }]);
      expect(body.byTask).toHaveLength(1);
      expect(body.byTask[0]).toMatchObject({
        title: "Write report",
        minutes: 25,
        intervals: 1,
      });
      expect(body.byCategory).toEqual([
        { category: "work", minutes: 25, intervals: 1 },
      ]);
    });

    it("counts cancels in the denominator only, with no minutes or breakdown surface", async () => {
      await setup();
      const service = serviceAt(NOW);
      const user = await makeUser("analytics-cancel");
      const deps = depsFor(user.id, user.email, service);

      await seedSession({
        userId: user.id,
        status: "completed",
        startedAt: new Date("2026-09-10T10:00:00.000Z"),
        actualDurationSeconds: 1500,
      });
      await seedSession({
        userId: user.id,
        status: "cancelled",
        startedAt: new Date("2026-09-10T09:00:00.000Z"),
        actualDurationSeconds: 600,
        taskTitleSnapshot: "Abandoned",
        categorySnapshot: "work",
      });

      const { body } = await get(deps, "?period=today");
      expect(body.totals).toMatchObject({
        completedFocusMinutes: 25,
        completedFocusIntervals: 1,
        cancelledFocusIntervals: 1,
        completionRate: 0.5,
        averageCompletedSeconds: 1500,
      });
      expect(body.daily).toEqual([{ date: "2026-09-10", minutes: 25, intervals: 1 }]);
      // The cancelled snapshot never surfaces in ranked lists.
      expect(body.byTask.map((r) => r.title)).not.toContain("Abandoned");
    });

    it("groups the same instants by local day in Berlin vs UTC", async () => {
      await setup();
      const service = serviceAt(NOW);
      const berlin = await makeUser("analytics-tz-berlin", "Europe/Berlin");
      const utc = await makeUser("analytics-tz-utc", "UTC");

      // A: Sep 09 22:30Z = Sep 10 00:30 Berlin (today) but Sep 09 UTC.
      // B: Sep 09 21:30Z = Sep 09 23:30 Berlin (yesterday).
      for (const user of [berlin, utc]) {
        await seedSession({ userId: user.id, startedAt: new Date("2026-09-09T22:30:00.000Z") });
        await seedSession({
          userId: user.id,
          startedAt: new Date("2026-09-09T21:30:00.000Z"),
          actualDurationSeconds: 600,
        });
      }

      const berlinToday = await get(depsFor(berlin.id, berlin.email, service), "?period=today");
      expect(berlinToday.body.timezone).toBe("Europe/Berlin");
      expect(berlinToday.body.daily).toEqual([
        { date: "2026-09-10", minutes: 25, intervals: 1 },
      ]);
      expect(berlinToday.body.totals.completedFocusMinutes).toBe(25);

      const berlinWeek = await get(depsFor(berlin.id, berlin.email, service), "?period=7d");
      expect(berlinWeek.body.daily.find((d) => d.date === "2026-09-10")).toMatchObject({
        minutes: 25,
        intervals: 1,
      });
      expect(berlinWeek.body.daily.find((d) => d.date === "2026-09-09")).toMatchObject({
        minutes: 10,
        intervals: 1,
      });

      // Same instants, UTC user: neither A nor B is "today" in UTC.
      const utcToday = await get(depsFor(utc.id, utc.email, service), "?period=today");
      expect(utcToday.body.daily).toEqual([{ date: "2026-09-10", minutes: 0, intervals: 0 }]);
      expect(utcToday.body.totals.completedFocusMinutes).toBe(0);
    });

    it("groups the spring-forward Sunday by calendar days with UTC stamps untouched", async () => {
      await setup();
      // 2026-03-29 02:00 CET -> 03:00 CEST (Berlin spring-forward Sunday).
      const now = new Date("2026-03-29T12:00:00.000Z");
      const service = serviceAt(now);
      const user = await makeUser("analytics-dst-spring", "Europe/Berlin");
      const deps = depsFor(user.id, user.email, service);

      // Mar 29 00:30 Berlin = Mar 28 23:30Z (today); Mar 28 00:30 Berlin = Mar 27 23:30Z.
      const todayRow = await seedSession({
        userId: user.id,
        startedAt: new Date("2026-03-28T23:30:00.000Z"),
        actualDurationSeconds: 1500,
      });
      await seedSession({
        userId: user.id,
        startedAt: new Date("2026-03-27T23:30:00.000Z"),
        actualDurationSeconds: 600,
      });

      const { body } = await get(deps, "?period=today");
      expect(body.window.from).toBe("2026-03-28T23:00:00.000Z");
      expect(body.daily).toEqual([{ date: "2026-03-29", minutes: 25, intervals: 1 }]);

      const week = await get(deps, "?period=7d");
      // Mar 29 minus 6 calendar days = Mar 23; Mar 23 midnight is still
      // CET (+1), so the window opens Mar 22 23:00Z — never N*24h.
      expect(week.body.window.from).toBe("2026-03-22T23:00:00.000Z");
      expect(week.body.daily.find((d) => d.date === "2026-03-29")).toMatchObject({
        minutes: 25,
        intervals: 1,
      });
      expect(week.body.daily.find((d) => d.date === "2026-03-28")).toMatchObject({
        minutes: 10,
        intervals: 1,
      });

      // DST grouping never rewrites the stored UTC stamp.
      const stored = await db.timerSession.findUniqueOrThrow({ where: { id: todayRow.id } });
      expect(stored.startedAt.toISOString()).toBe("2026-03-28T23:30:00.000Z");
    });

    it("groups the fall-back Sunday by calendar days with UTC stamps untouched", async () => {
      await setup();
      // 2026-10-25 03:00 CEST -> 02:00 CET (Berlin fall-back Sunday).
      const now = new Date("2026-10-25T12:00:00.000Z");
      const service = serviceAt(now);
      const user = await makeUser("analytics-dst-fall", "Europe/Berlin");
      const deps = depsFor(user.id, user.email, service);

      // Oct 25 00:30 Berlin (still CEST) = Oct 24 22:30Z (today);
      // Oct 24 00:30 Berlin = Oct 23 22:30Z.
      const todayRow = await seedSession({
        userId: user.id,
        startedAt: new Date("2026-10-24T22:30:00.000Z"),
        actualDurationSeconds: 1500,
      });
      await seedSession({
        userId: user.id,
        startedAt: new Date("2026-10-23T22:30:00.000Z"),
        actualDurationSeconds: 600,
      });

      const { body } = await get(deps, "?period=today");
      expect(body.window.from).toBe("2026-10-24T22:00:00.000Z");
      expect(body.daily).toEqual([{ date: "2026-10-25", minutes: 25, intervals: 1 }]);

      const week = await get(deps, "?period=7d");
      // Oct 25 minus 6 calendar days = Oct 19; Oct 19 midnight is still
      // CEST (+2), so the window opens Oct 18 22:00Z — never N*24h.
      expect(week.body.window.from).toBe("2026-10-18T22:00:00.000Z");
      expect(week.body.daily.find((d) => d.date === "2026-10-25")).toMatchObject({
        minutes: 25,
        intervals: 1,
      });

      const stored = await db.timerSession.findUniqueOrThrow({ where: { id: todayRow.id } });
      expect(stored.startedAt.toISOString()).toBe("2026-10-24T22:30:00.000Z");
    });

    it("resolves the local day past the date line (UTC+14)", async () => {
      await setup();
      const now = new Date("2026-01-15T12:00:00.000Z");
      const service = serviceAt(now);
      const user = await makeUser("analytics-dateline", "Pacific/Kiritimati");
      const deps = depsFor(user.id, user.email, service);

      // Jan 15 11:00Z = Jan 16 01:00 Kiritimati (today); Jan 15 09:00Z = Jan 15 23:00 (yesterday).
      await seedSession({
        userId: user.id,
        startedAt: new Date("2026-01-15T11:00:00.000Z"),
        actualDurationSeconds: 1500,
      });
      await seedSession({
        userId: user.id,
        startedAt: new Date("2026-01-15T09:00:00.000Z"),
        actualDurationSeconds: 600,
      });

      const { body } = await get(deps, "?period=today");
      expect(body.timezone).toBe("Pacific/Kiritimati");
      expect(body.window.from).toBe("2026-01-15T10:00:00.000Z");
      expect(body.daily).toEqual([{ date: "2026-01-16", minutes: 25, intervals: 1 }]);
    });

    it("counts completed tasks and ranks by-task/by-category with averages", async () => {
      await setup();
      const service = serviceAt(NOW);
      const user = await makeUser("analytics-groups");
      const deps = depsFor(user.id, user.email, service);

      const taskA = await db.task.create({
        data: { userId: user.id, title: "Write notes", category: "Writing", position: 1000 },
      });
      const taskB = await db.task.create({
        data: { userId: user.id, title: "Review PRs", category: "Work", position: 2000 },
      });
      await seedSession({
        userId: user.id,
        taskId: taskA.id,
        taskTitleSnapshot: "Write notes",
        categorySnapshot: "Writing",
        startedAt: new Date("2026-09-10T10:00:00.000Z"),
        actualDurationSeconds: 1500,
      });
      await seedSession({
        userId: user.id,
        taskId: taskA.id,
        taskTitleSnapshot: "Write notes",
        categorySnapshot: "Writing",
        startedAt: new Date("2026-09-09T10:00:00.000Z"),
        actualDurationSeconds: 1500,
      });
      await seedSession({
        userId: user.id,
        taskId: taskB.id,
        taskTitleSnapshot: "Review PRs",
        categorySnapshot: "Work",
        startedAt: new Date("2026-09-09T09:00:00.000Z"),
        actualDurationSeconds: 600,
      });
      await seedSession({
        userId: user.id,
        startedAt: new Date("2026-09-08T10:00:00.000Z"),
        actualDurationSeconds: 300,
      });

      // Two tasks complete inside the week; one completes outside it.
      await db.task.updateMany({
        where: { id: taskA.id },
        data: { status: "completed", completedAt: new Date("2026-09-09T12:00:00.000Z") },
      });
      await db.task.updateMany({
        where: { id: taskB.id },
        data: { status: "completed", completedAt: new Date("2026-09-08T12:00:00.000Z") },
      });
      const oldTask = await db.task.create({
        data: {
          userId: user.id,
          title: "Old",
          position: 3000,
          status: "completed",
          completedAt: new Date("2026-08-01T12:00:00.000Z"),
        },
      });
      void oldTask;

      // Deleted-task legibility: soft-delete task B (backfills snapshots);
      // a later rename must not rewrite its analytics rows.
      await createPrismaTaskStore(db).softDeleteWithSnapshots(taskB.id, user.id, NOW);
      await db.task.updateMany({
        where: { id: taskB.id, userId: user.id },
        data: { title: "Renamed" },
      });

      const { body } = await get(deps, "?period=7d");
      // 25 + 25 + 10 + 5 = 65 minutes; the soft-deleted completion no
      // longer counts as a live completed task.
      expect(body.totals).toMatchObject({
        completedFocusMinutes: 65,
        completedFocusIntervals: 4,
        cancelledFocusIntervals: 0,
        completedTasks: 1,
        completionRate: 1,
        averageCompletedSeconds: 975,
      });
      expect(body.byTask[0]).toMatchObject({
        taskId: taskA.id,
        title: "Write notes",
        minutes: 50,
        intervals: 2,
      });
      // Stored snapshot wins over the post-delete rename.
      expect(body.byTask.find((r) => r.taskId === taskB.id)).toMatchObject({
        title: "Review PRs",
        minutes: 10,
        intervals: 1,
      });
      expect(body.byTask.find((r) => r.taskId === null)).toMatchObject({
        title: null,
        minutes: 5,
        intervals: 1,
      });
      expect(body.byCategory[0]).toMatchObject({
        category: "Writing",
        minutes: 50,
        intervals: 2,
      });
      expect(body.byCategory.find((r) => r.category === null)).toMatchObject({
        minutes: 5,
        intervals: 1,
      });
    });

    it("returns an empty-state aggregate with null rate and zero-filled bars", async () => {
      await setup();
      const service = serviceAt(NOW);
      const user = await makeUser("analytics-empty");
      const { status, body } = await get(depsFor(user.id, user.email, service));
      expect(status).toBe(200);
      expect(body.period).toBe("7d");
      expect(body.totals).toEqual({
        completedFocusMinutes: 0,
        completedFocusIntervals: 0,
        cancelledFocusIntervals: 0,
        completedTasks: 0,
        completionRate: null,
        averageCompletedSeconds: null,
      });
      expect(body.daily).toHaveLength(7);
      expect(body.daily[0].date).toBe("2026-09-04");
      expect(body.daily[6].date).toBe("2026-09-10");
      expect(body.daily.every((d) => d.minutes === 0 && d.intervals === 0)).toBe(true);
      expect(body.byTask).toEqual([]);
      expect(body.byCategory).toEqual([]);
    });

    it("isolates users, requires a session, and rejects bad periods as 400s", async () => {
      await setup();
      const service = serviceAt(NOW);
      const a = await makeUser("analytics-scope-a");
      const b = await makeUser("analytics-scope-b");
      const depsA = depsFor(a.id, a.email, service);
      const depsB = depsFor(b.id, b.email, service);

      await seedSession({
        userId: a.id,
        taskTitleSnapshot: "A private",
        startedAt: new Date("2026-09-10T10:00:00.000Z"),
      });
      await seedSession({
        userId: b.id,
        taskTitleSnapshot: "B private",
        startedAt: new Date("2026-09-10T10:00:00.000Z"),
      });

      const listB = await get(depsB, "?period=today");
      expect(listB.body.totals.completedFocusMinutes).toBe(25);
      expect(listB.body.byTask).toMatchObject([{ title: "B private" }]);
      const listA = await get(depsA, "?period=today");
      expect(listA.body.byTask).toMatchObject([{ title: "A private" }]);

      const signedOut: AnalyticsHandlerDeps = {
        getService: async () => service,
        getSession: async () => null,
      };
      expect((await get(signedOut)).status).toBe(401);

      for (const query of ["?period=week", "?period=30d", "?period=", "?period=7D"]) {
        const res = await get(depsA, query);
        expect(res.status).toBe(400);
      }
      const bad = await get(depsA, "?period=week");
      const badBody = bad.body as unknown as {
        error: { code: string; fields: Record<string, string[]> };
      };
      expect(badBody.error.code).toBe("VALIDATION_ERROR");
      expect(badBody.error.fields.period).toHaveLength(1);
    });
  },
  60_000,
);
