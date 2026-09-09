import type { PrismaClient } from "@prisma/client";
import type { TaskRow, TaskStatus, TaskStore } from "./service";

function toRow(row: {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  category: string | null;
  status: TaskStatus;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
}): TaskRow {
  return { ...row };
}

/**
 * Production store: TaskStore over Prisma (the only data-access path per
 * SYSTEM_DESIGN §1). Every method scopes by `userId` — identity always
 * arrives from the session via the service, never from client input
 * (spec §11.5). Thin mapping only; all domain rules live in service.ts and
 * are covered hermetically there. Live-DB coverage lands in
 * app/api/tasks/tasks.integration.test.ts.
 */
export function createPrismaTaskStore(db: PrismaClient): TaskStore {
  return {
    async highestPosition(userId) {
      const agg = await db.task.aggregate({
        _max: { position: true },
        where: { userId, deletedAt: null },
      });
      return agg._max.position;
    },

    async createTask(data) {
      return toRow(
        await db.task.create({
          data: {
            userId: data.userId,
            title: data.title,
            notes: data.notes,
            category: data.category,
            position: data.position,
          },
        }),
      );
    },

    async findTask(id, userId) {
      const row = await db.task.findFirst({ where: { id, userId } });
      return row ? toRow(row) : null;
    },

    async listTasks(userId, filter) {
      return (
        await db.task.findMany({
          where: {
            userId,
            deletedAt: null,
            ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
            ...(filter.cursor
              ? {
                  OR: [
                    { position: { gt: filter.cursor.position } },
                    {
                      position: filter.cursor.position,
                      id: { gt: filter.cursor.id },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          take: filter.take,
        })
      ).map(toRow);
    },

    async updateTask(id, userId, data) {
      // Scoped write (spec §10.6): the `userId` predicate re-enters every
      // mutation so the store enforces isolation even for direct callers —
      // the service's scoped read alone would leave a check-then-act gap.
      // `updateMany` + count keeps the check and the write atomic
      // (ownership itself is immutable, so no TOCTOU on the predicate).
      const { count } = await db.task.updateMany({
        where: { id, userId },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.category !== undefined ? { category: data.category } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.completedAt !== undefined
            ? { completedAt: data.completedAt }
            : {}),
        },
      });
      if (count === 0) throw new Error("tasks.updateTask: missing scoped row");
      const row = await db.task.findFirst({ where: { id, userId } });
      if (!row) throw new Error("tasks.updateTask: missing scoped row");
      return toRow(row);
    },

    async softDeleteWithSnapshots(id, userId, at) {
      return db.$transaction(async (tx) => {
        const row = await tx.task.findFirst({ where: { id, userId } });
        if (!row) throw new Error("tasks.remove: missing scoped row");
        const { count } = await tx.task.updateMany({
          where: { id, userId },
          data: { deletedAt: at },
        });
        if (count === 0) throw new Error("tasks.remove: missing scoped row");
        const removed = (await tx.task.findFirst({
          where: { id, userId },
        }))!;
        // Snapshot backfill (spec §8.2): sessions keep a legible title and
        // category after their task is gone. Only null snapshots are
        // touched — finalize-time snapshots (issues 10/11) always win.
        await tx.timerSession.updateMany({
          where: { userId, taskId: id, taskTitleSnapshot: null },
          data: { taskTitleSnapshot: removed.title },
        });
        await tx.timerSession.updateMany({
          where: { userId, taskId: id, categorySnapshot: null },
          data: { categorySnapshot: removed.category },
        });
        return toRow(removed);
      });
    },

    async activeTaskIds(userId) {
      return (
        await db.task.findMany({
          where: { userId, status: "active", deletedAt: null },
          select: { id: true },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        })
      ).map((row) => row.id);
    },

    async reorderTasks(userId, positions) {
      // One transaction: the full active order lands atomically — a
      // re-list mid-reorder never observes a half-written sequence.
      // Scoped writes throughout (spec §10.6): a zero count means a listed
      // id escaped its owner, so the whole transaction aborts.
      const counts = await db.$transaction(
        positions.map(({ id, position }) =>
          db.task.updateMany({ where: { id, userId }, data: { position } }),
        ),
      );
      if (counts.some((result) => result.count !== 1)) {
        throw new Error("tasks.reorderTasks: scoped write missed");
      }
      const byId = new Map(
        (
          await db.task.findMany({
            where: { id: { in: positions.map((entry) => entry.id) }, userId },
          })
        ).map((row) => [row.id, toRow(row)] as const),
      );
      return positions.map(({ id }) => byId.get(id)!);
    },

    async lockedTaskId(userId) {
      const session = await db.timerSession.findFirst({
        where: {
          userId,
          status: { in: ["running", "paused"] },
          taskId: { not: null },
        },
        select: { taskId: true },
      });
      return session?.taskId ?? null;
    },
  };
}
