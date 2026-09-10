import type { PrismaClient } from "@prisma/client";
import type {
  AnalyticsFocusRow,
  AnalyticsFocusStatus,
  AnalyticsStore,
} from "./service";

/**
 * Production store: AnalyticsStore over Prisma (the only data-access path
 * per SYSTEM_DESIGN §1). Every method scopes by `userId` — identity always
 * arrives from the session via the service, never from client input
 * (spec §11.5). Thin mapping + read-only queries only; period math and
 * aggregation live in service.ts and are covered hermetically there.
 * Live-DB coverage lands in
 * app/api/analytics/summary/analytics.integration.test.ts.
 */
export function createPrismaAnalyticsStore(db: PrismaClient): AnalyticsStore {
  return {
    async getTimezone(userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      return user?.timezone ?? "UTC";
    },

    async listFocusSessions(userId, window) {
      const rows = await db.timerSession.findMany({
        where: {
          userId,
          // Focus metrics only (spec §8.9): breaks never contribute, and
          // the workspace owns running/paused rows — analytics reflects
          // finalized focus intervals. Cancelled rows ride along for the
          // completion-rate denominator; the service splits them out.
          intervalType: "focus",
          status: { in: ["completed", "cancelled"] },
          startedAt: { gte: window.from, lte: window.to },
        },
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        include: { task: { select: { title: true, category: true } } },
      });
      return rows.map(
        (row): AnalyticsFocusRow => ({
          id: row.id,
          userId: row.userId,
          taskId: row.taskId,
          // Snapshot legibility (spec §8.2/§8.9): the stored snapshot wins
          // so a later task rename never rewrites analytics; the live
          // title is the fallback for rows whose snapshot is null while
          // their task still exists. Null renders as Unassigned /
          // Uncategorized in the UI (issue 16).
          taskTitleSnapshot:
            row.taskTitleSnapshot ?? row.task?.title ?? null,
          categorySnapshot:
            row.categorySnapshot ?? row.task?.category ?? null,
          status: row.status as AnalyticsFocusStatus,
          actualDurationSeconds: row.actualDurationSeconds,
          startedAt: row.startedAt,
        }),
      );
    },

    async countCompletedTasks(userId, window) {
      return db.task.count({
        where: {
          userId,
          status: "completed",
          completedAt: { gte: window.from, lte: window.to },
          deletedAt: null,
        },
      });
    },
  };
}
