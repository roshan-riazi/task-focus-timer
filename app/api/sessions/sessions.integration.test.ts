import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createListSessionsHandler,
  type HistoryHandlerDeps,
} from "@/lib/sessions/handlers";
import { createPrismaHistoryStore } from "@/lib/sessions/prisma-store";
import { createHistoryService, type HistoryService } from "@/lib/sessions/service";
import { createPrismaTaskStore } from "@/lib/tasks/prisma-store";
import type { AppSession } from "@/lib/auth/session";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

const APP_URL = "http://localhost:3000";
// Fixed clock: all period windows below derive from this instant.
const NOW = new Date("2026-09-10T12:00:00.000Z");

/**
 * Issue 14 acceptance against live Postgres (TEST_STRATEGY §2, API level):
 *
 * - Reverse-chron finalized sessions with snapshots; running/paused rows
 *   never appear.
 * - Today/7d/30d windows resolve in the user's timezone (Berlin vs UTC
 *   contrast), not UTC days.
 * - `type=focus` hides persisted breaks; the default shows every type.
 * - Opaque `(started_at, id)` cursors paginate and stay stable under
 *   inserts (new rows land on page one; outstanding cursors don't shift).
 * - Deleted-task sessions stay legible via snapshots (incl. the issue-07
 *   backfill contract); live tasks back null snapshots; stored snapshots
 *   win over later renames.
 * - Per-user scoping both directions; signed-out reads as 401; bad
 *   filters/cursors fail as 400s, never 500s.
 */
describeIfDb(
  "history API (live Postgres)",
  () => {
    let db: PrismaClient;
    let service: HistoryService;
    const createdUserIds: string[] = [];

    async function setup(): Promise<void> {
      const mod = await import("@/lib/db");
      db = mod.db;
      service = createHistoryService({
        now: () => NOW,
        store: createPrismaHistoryStore(db),
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

    function depsFor(userId: string, userEmail: string): HistoryHandlerDeps {
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

    type SessionBody = {
      id: string;
      taskId: string | null;
      taskTitleSnapshot: string | null;
      categorySnapshot: string | null;
      intervalType: string;
      status: string;
      plannedDurationSeconds: number;
      actualDurationSeconds: number | null;
      startedAt: string;
      completedAt: string | null;
      cancelledAt: string | null;
    };

    type ListBody = { sessions: SessionBody[]; nextCursor: string | null };

    async function get(
      deps: HistoryHandlerDeps,
      query = "",
    ): Promise<{ status: number; body: ListBody }> {
      const res = await createListSessionsHandler(deps)(
        new Request(`${APP_URL}/api/sessions${query}`, { method: "GET" }),
      );
      return { status: res.status, body: (await res.json()) as ListBody };
    }

    afterEach(async () => {
      if (db) {
        // Users cascade to tasks, sessions, settings, and cycle state.
        await db.user.deleteMany({
          where: { id: { in: createdUserIds.splice(0) } },
        });
      }
    });

    it("lists finalized sessions reverse-chron with snapshots, excluding active rows", async () => {
      await setup();
      const user = await makeUser("history-order");
      const deps = depsFor(user.id, user.email);

      const focus = await seedSession({
        userId: user.id,
        intervalType: "focus",
        status: "completed",
        startedAt: new Date("2026-09-10T10:00:00.000Z"),
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
      const cancelled = await seedSession({
        userId: user.id,
        intervalType: "focus",
        status: "cancelled",
        startedAt: new Date("2026-09-09T10:00:00.000Z"),
        actualDurationSeconds: 600,
      });
      await seedSession({
        userId: user.id,
        intervalType: "focus",
        status: "running",
        startedAt: new Date("2026-09-10T11:00:00.000Z"),
        actualDurationSeconds: null,
      });
      // Future-dated rows belong to no window yet (the range is closed at now).
      await seedSession({
        userId: user.id,
        intervalType: "focus",
        status: "completed",
        startedAt: new Date("2026-09-11T10:00:00.000Z"),
      });

      const { status, body } = await get(deps);
      expect(status).toBe(200);
      // Newest first; the running row and the future-dated row never appear.
      expect(body.sessions.map((s) => s.id)).toEqual([
        focus.id,
        expect.any(String),
        cancelled.id,
      ]);
      expect(body.sessions).toHaveLength(3);
      expect(body.nextCursor).toBeNull();
      expect(body.sessions[0]).toMatchObject({
        intervalType: "focus",
        status: "completed",
        taskTitleSnapshot: "Write report",
        categorySnapshot: "work",
        plannedDurationSeconds: 1500,
        actualDurationSeconds: 1500,
        startedAt: "2026-09-10T10:00:00.000Z",
      });
      expect(body.sessions[1]).toMatchObject({
        intervalType: "short_break",
        taskTitleSnapshot: null,
      });

      // A paused row on another user is excluded the same way (one active
      // row per user keeps both states off a single user's history).
      const other = await makeUser("history-paused");
      await seedSession({
        userId: other.id,
        intervalType: "short_break",
        status: "paused",
        startedAt: new Date("2026-09-10T08:00:00.000Z"),
        actualDurationSeconds: null,
      });
      const empty = await get(depsFor(other.id, other.email));
      expect(empty.body.sessions).toEqual([]);
      expect(empty.body.nextCursor).toBeNull();
    });

    it("resolves Today/7d/30d in the user's timezone, not UTC", async () => {
      await setup();
      const berlin = await makeUser("history-tz", "Europe/Berlin");
      const utc = await makeUser("history-utc", "UTC");

      // A: Sep 09 22:30Z = Sep 10 00:30 Berlin (today) but Sep 09 UTC.
      // B: Sep 09 21:30Z = Sep 09 23:30 Berlin (yesterday).
      const stamps = {
        a: new Date("2026-09-09T22:30:00.000Z"),
        b: new Date("2026-09-09T21:30:00.000Z"),
        old: new Date("2026-08-20T10:00:00.000Z"),
        ancient: new Date("2026-07-01T10:00:00.000Z"),
      };
      for (const user of [berlin, utc]) {
        for (const startedAt of Object.values(stamps)) {
          await seedSession({ userId: user.id, startedAt });
        }
      }

      const berlinDeps = depsFor(berlin.id, berlin.email);
      const today = await get(berlinDeps, "?period=today");
      expect(today.body.sessions.map((s) => s.startedAt)).toEqual([
        "2026-09-09T22:30:00.000Z",
      ]);

      const week = await get(berlinDeps, "?period=7d");
      expect(week.body.sessions.map((s) => s.startedAt)).toEqual([
        "2026-09-09T22:30:00.000Z",
        "2026-09-09T21:30:00.000Z",
      ]);

      const month = await get(berlinDeps, "?period=30d");
      expect(month.body.sessions.map((s) => s.startedAt)).toEqual([
        "2026-09-09T22:30:00.000Z",
        "2026-09-09T21:30:00.000Z",
        "2026-08-20T10:00:00.000Z",
      ]);

      // Same instants, UTC user: neither A nor B is "today" in UTC.
      const utcToday = await get(depsFor(utc.id, utc.email), "?period=today");
      expect(utcToday.body.sessions).toEqual([]);
    });

    it("shows breaks by default and hides them with type=focus", async () => {
      await setup();
      const user = await makeUser("history-types");
      const deps = depsFor(user.id, user.email);

      await seedSession({
        userId: user.id,
        intervalType: "focus",
        startedAt: new Date("2026-09-10T10:00:00.000Z"),
      });
      await seedSession({
        userId: user.id,
        intervalType: "short_break",
        startedAt: new Date("2026-09-10T09:00:00.000Z"),
        actualDurationSeconds: 300,
      });
      await seedSession({
        userId: user.id,
        intervalType: "long_break",
        startedAt: new Date("2026-09-09T10:00:00.000Z"),
        actualDurationSeconds: 900,
      });

      const all = await get(deps);
      expect(all.body.sessions.map((s) => s.intervalType)).toEqual([
        "focus",
        "short_break",
        "long_break",
      ]);
      const explicitAll = await get(deps, "?type=all");
      expect(explicitAll.body.sessions).toHaveLength(3);
      const focusOnly = await get(deps, "?type=focus");
      expect(focusOnly.body.sessions.map((s) => s.intervalType)).toEqual([
        "focus",
      ]);
    });

    it("paginates with opaque cursors that stay stable under inserts", async () => {
      await setup();
      const user = await makeUser("history-pages");
      const deps = depsFor(user.id, user.email);

      const s1 = await seedSession({
        userId: user.id,
        startedAt: new Date("2026-09-10T10:00:00.000Z"),
      });
      const s2 = await seedSession({
        userId: user.id,
        startedAt: new Date("2026-09-09T10:00:00.000Z"),
      });
      const s3 = await seedSession({
        userId: user.id,
        startedAt: new Date("2026-09-08T10:00:00.000Z"),
      });

      const page1 = await get(deps, "?limit=1");
      expect(page1.body.sessions.map((s) => s.id)).toEqual([s1.id]);
      expect(typeof page1.body.nextCursor).toBe("string");

      const page2 = await get(deps, `?limit=1&cursor=${page1.body.nextCursor}`);
      expect(page2.body.sessions.map((s) => s.id)).toEqual([s2.id]);

      const page3 = await get(deps, `?limit=1&cursor=${page2.body.nextCursor}`);
      expect(page3.body.sessions.map((s) => s.id)).toEqual([s3.id]);
      expect(page3.body.nextCursor).toBeNull();

      // A new session lands on page one; the outstanding cursor still
      // resolves to the same second page (keyset, not offset).
      const fresh = await seedSession({
        userId: user.id,
        startedAt: new Date("2026-09-10T11:00:00.000Z"),
      });
      const reread = await get(deps, "?limit=1");
      expect(reread.body.sessions.map((s) => s.id)).toEqual([fresh.id]);
      const stable = await get(deps, `?limit=1&cursor=${page1.body.nextCursor}`);
      expect(stable.body.sessions.map((s) => s.id)).toEqual([s2.id]);
    });

    it("keeps deleted-task sessions legible and prefers stored snapshots", async () => {
      await setup();
      const user = await makeUser("history-snapshots");
      const deps = depsFor(user.id, user.email);

      const task = await db.task.create({
        data: { userId: user.id, title: "Trip", category: "travel", position: 1000 },
      });
      // Null snapshots simulate a row finalized before the backfill path;
      // the live task keeps it legible until deletion.
      await seedSession({
        userId: user.id,
        taskId: task.id,
        startedAt: new Date("2026-09-09T10:00:00.000Z"),
      });
      // A stored snapshot survives later renames (snapshot wins).
      await seedSession({
        userId: user.id,
        taskId: task.id,
        taskTitleSnapshot: "Original title",
        categorySnapshot: "work",
        startedAt: new Date("2026-09-08T10:00:00.000Z"),
      });
      await seedSession({
        userId: user.id,
        intervalType: "short_break",
        startedAt: new Date("2026-09-07T10:00:00.000Z"),
      });

      const before = await get(deps, "?period=30d");
      expect(before.body.sessions[0].taskTitleSnapshot).toBe("Trip");
      expect(before.body.sessions[0].categorySnapshot).toBe("travel");
      expect(before.body.sessions[2].taskTitleSnapshot).toBeNull();

      await createPrismaTaskStore(db).softDeleteWithSnapshots(task.id, user.id, NOW);
      // A later rename of the (soft-deleted) task row must not rewrite
      // history: stored snapshots win over the live title.
      await db.task.updateMany({
        where: { id: task.id, userId: user.id },
        data: { title: "Renamed" },
      });

      const after = await get(deps, "?period=30d");
      // Backfilled snapshot keeps the first row legible; the stored
      // snapshot still wins over the rename on the second row.
      expect(after.body.sessions[0].taskTitleSnapshot).toBe("Trip");
      expect(after.body.sessions[0].categorySnapshot).toBe("travel");
      expect(after.body.sessions[1].taskTitleSnapshot).toBe("Original title");
      expect(after.body.sessions[1].categorySnapshot).toBe("work");
      // Unassigned rows stay null (the UI renders "Unassigned").
      expect(after.body.sessions[2].taskTitleSnapshot).toBeNull();
    });

    it("isolates users, requires a session, and rejects bad input as 400s", async () => {
      await setup();
      const a = await makeUser("history-scope-a");
      const b = await makeUser("history-scope-b");
      const depsA = depsFor(a.id, a.email);
      const depsB = depsFor(b.id, b.email);

      const owned = await seedSession({
        userId: a.id,
        taskTitleSnapshot: "A private",
        startedAt: new Date("2026-09-10T10:00:00.000Z"),
      });
      await seedSession({
        userId: b.id,
        taskTitleSnapshot: "B private",
        startedAt: new Date("2026-09-10T10:00:00.000Z"),
      });

      const listB = await get(depsB);
      expect(listB.body.sessions.map((s) => s.id)).not.toContain(owned.id);
      expect(listB.body.sessions.map((s) => s.taskTitleSnapshot)).toEqual([
        "B private",
      ]);
      const listA = await get(depsA);
      expect(listA.body.sessions.map((s) => s.taskTitleSnapshot)).toEqual([
        "A private",
      ]);

      const signedOut: HistoryHandlerDeps = {
        getService: async () => service,
        getSession: async () => null,
      };
      expect((await get(signedOut)).status).toBe(401);

      for (const query of [
        "?period=week",
        "?type=breaks",
        "?limit=0",
        "?limit=101",
        "?cursor=bogus",
      ]) {
        const res = await get(depsA, query);
        expect(res.status).toBe(400);
      }
      const forged = await get(depsA, "?cursor=bogus");
      const forgedBody = forged.body as unknown as {
        error: { code: string; fields: Record<string, string[]> };
      };
      expect(forgedBody.error.code).toBe("VALIDATION_ERROR");
      expect(forgedBody.error.fields.cursor).toHaveLength(1);
      // Sessions are absent on 400.
      expect(forged.body.sessions).toBeUndefined();
    });

    it("returns an empty page with a null cursor when there is no history", async () => {
      await setup();
      const user = await makeUser("history-empty");
      const { status, body } = await get(depsFor(user.id, user.email));
      expect(status).toBe(200);
      expect(body).toEqual({ sessions: [], nextCursor: null });
    });
  },
  60_000,
);
