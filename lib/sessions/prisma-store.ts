import type { PrismaClient } from "@prisma/client";
import type {
  HistoryIntervalType,
  HistoryRow,
  HistoryStatus,
  HistoryStore,
} from "./service";

/**
 * Production store: HistoryStore over Prisma (the only data-access path per
 * SYSTEM_DESIGN §1). Every method scopes by `userId` — identity always
 * arrives from the session via the service, never from client input
 * (spec §11.5). Thin mapping + read-only queries only; period math and
 * cursor pagination live in service.ts and are covered hermetically there.
 * Live-DB coverage lands in
 * app/api/sessions/sessions.integration.test.ts.
 */
export function createPrismaHistoryStore(db: PrismaClient): HistoryStore {
  return {
    async getTimezone(userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      return user?.timezone ?? "UTC";
    },

    async listSessions(userId, filter) {
      const rows = await db.timerSession.findMany({
        where: {
          userId,
          // History is finalized intervals only (spec §8.8): the workspace
          // owns running/paused rows; history reflects records with a
          // completion or cancellation stamp.
          status: { in: ["completed", "cancelled"] },
          startedAt: { gte: filter.from, lte: filter.to },
          ...(filter.intervalTypes
            ? { intervalType: { in: filter.intervalTypes } }
            : {}),
          ...(filter.cursor
            ? {
                OR: [
                  { startedAt: { lt: filter.cursor.startedAt } },
                  {
                    startedAt: filter.cursor.startedAt,
                    id: { lt: filter.cursor.id },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: filter.take,
        include: { task: { select: { title: true, category: true } } },
      });
      return rows.map(
        (row): HistoryRow => ({
          id: row.id,
          userId: row.userId,
          taskId: row.taskId,
          // Snapshot legibility (spec §8.2): the stored snapshot wins so a
          // later task rename never rewrites history; the live title is the
          // fallback for rows whose snapshot is null (finalize resilience,
          // issue 10) while their task still exists. Null renders as
          // "Unassigned" in the UI.
          taskTitleSnapshot:
            row.taskTitleSnapshot ?? row.task?.title ?? null,
          categorySnapshot:
            row.categorySnapshot ?? row.task?.category ?? null,
          intervalType: row.intervalType as HistoryIntervalType,
          status: row.status as HistoryStatus,
          plannedDurationSeconds: row.plannedDurationSeconds,
          actualDurationSeconds: row.actualDurationSeconds,
          startedAt: row.startedAt,
          expectedEndAt: row.expectedEndAt,
          completedAt: row.completedAt,
          cancelledAt: row.cancelledAt,
        }),
      );
    },
  };
}
