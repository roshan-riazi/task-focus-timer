import { z } from "zod";
import { flattenZodFields } from "../auth/validation";
import {
  createTaskSchema,
  listTasksQuerySchema,
  reorderTasksSchema,
  taskIdParamSchema,
  updateTaskSchema,
} from "./validation";

export type TaskStatus = "active" | "completed" | "archived";

/** Storage-shaped row (Dates in, ISO strings out via `toPublicTask`). */
export interface TaskRow {
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
}

export interface TaskSessionRow {
  id: string;
  userId: string;
  taskId: string | null;
  status: string;
  taskTitleSnapshot: string | null;
  categorySnapshot: string | null;
}

export interface PublicTask {
  id: string;
  title: string;
  notes: string | null;
  category: string | null;
  status: TaskStatus;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
}

export function toPublicTask(row: TaskRow): PublicTask {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    category: row.category,
    status: row.status,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

export type TaskErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "TASK_LOCKED_BY_TIMER";

/**
 * Typed service failure. Routes map codes to HTTP status + envelope
 * (VALIDATION_ERROR → 400 with field map, NOT_FOUND → 404 leak-free,
 * TASK_LOCKED_BY_TIMER → 409); anything else is a 500.
 */
export class TaskServiceError extends Error {
  readonly fields?: Record<string, string[]>;
  constructor(
    readonly code: TaskErrorCode,
    message: string,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "TaskServiceError";
    this.fields = fields;
  }
}

/**
 * System boundaries behind the task service (health-route factory pattern:
 * callers inject the boundary; unit tests inject the in-memory fake in
 * service.test.ts; routes inject the Prisma store in prisma-store.ts).
 */
export interface TaskStore {
  highestPosition(userId: string): Promise<number | null>;
  createTask(data: {
    userId: string;
    title: string;
    notes?: string;
    category?: string;
    position: number;
  }): Promise<TaskRow>;
  /** Scoped to the user; includes soft-deleted rows (service decides visibility). */
  findTask(id: string, userId: string): Promise<TaskRow | null>;
  listTasks(
    userId: string,
    filter: {
      statuses: TaskStatus[] | null;
      cursor?: { position: number; id: string };
      take: number;
    },
  ): Promise<TaskRow[]>;
  updateTask(
    id: string,
    userId: string,
    data: Partial<
      Pick<TaskRow, "title" | "notes" | "category" | "status" | "completedAt">
    >,
  ): Promise<TaskRow>;
  /**
   * One transaction: stamp `deletedAt` and backfill null
   * title/category snapshots on this task's sessions (spec §8.2: history
   * survives deletion).
   */
  softDeleteWithSnapshots(
    id: string,
    userId: string,
    at: Date,
  ): Promise<TaskRow>;
  activeTaskIds(userId: string): Promise<string[]>;
  reorderTasks(
    userId: string,
    positions: { id: string; position: number }[],
  ): Promise<TaskRow[]>;
  /** Task id of the user's running/paused interval, if any. */
  lockedTaskId(userId: string): Promise<string | null>;
}

export interface TaskPorts {
  now(): Date;
  store: TaskStore;
}

/** Fractional-ranking step (SYSTEM_DESIGN §5/§10.3): full rewrites stay clean. */
export const TASK_POSITION_STEP = 1000;

function validationError(error: z.ZodError): TaskServiceError {
  return new TaskServiceError(
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

/**
 * Opaque page token over `(position, id)` — the list order. Base64url JSON
 * carries no task content (position + uuid only), so it is safe to log;
 * anything unforgable decodes to a 400, never a 500.
 */
export function encodeCursor(cursor: { position: number; id: string }): string {
  return Buffer.from(
    JSON.stringify({ p: cursor.position, i: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeCursor(token: string): { position: number; id: string } {
  try {
    const raw = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8"),
    ) as unknown;
    if (
      typeof raw !== "object" ||
      raw === null ||
      !("p" in raw) ||
      !("i" in raw)
    ) {
      throw new Error("bad cursor shape");
    }
    const { p, i } = raw as { p: unknown; i: unknown };
    if (typeof p !== "number" || !Number.isFinite(p) || typeof i !== "string") {
      throw new Error("bad cursor fields");
    }
    parse(taskIdParamSchema, i);
    return { position: p, id: i };
  } catch (error) {
    if (error instanceof TaskServiceError) throw error;
    throw new TaskServiceError("VALIDATION_ERROR", "This page has expired.", {
      cursor: ["This page has expired. Start from the first page."],
    });
  }
}

export function createTaskService(ports: TaskPorts) {
  async function scoped(id: string, userId: string): Promise<TaskRow> {
    const row = await ports.store.findTask(parse(taskIdParamSchema, id), userId);
    // Leak-free denial (spec §12.2): foreign, missing, and soft-deleted
    // rows all read as NOT_FOUND — except `remove`, which resolves the row
    // itself so repeat deletes stay idempotent.
    if (!row || row.deletedAt !== null) {
      throw new TaskServiceError("NOT_FOUND", "Not found.");
    }
    return row;
  }

  async function assertUnlocked(userId: string, taskId: string): Promise<void> {
    if ((await ports.store.lockedTaskId(userId)) === taskId) {
      throw new TaskServiceError(
        "TASK_LOCKED_BY_TIMER",
        "Finish or cancel the current interval before changing this task.",
      );
    }
  }

  return {
    async create(userId: string, input: unknown): Promise<PublicTask> {
      const data = parse(createTaskSchema, input);
      const highest = await ports.store.highestPosition(userId);
      const position =
        highest === null ? TASK_POSITION_STEP : highest + TASK_POSITION_STEP;
      const row = await ports.store.createTask({
        userId,
        title: data.title,
        notes: data.notes,
        category: data.category,
        position,
      });
      return toPublicTask(row);
    },

    async list(
      userId: string,
      input: unknown,
    ): Promise<{ tasks: PublicTask[]; nextCursor: string | null }> {
      const query = parse(listTasksQuerySchema, input);
      const statuses =
        query.status === "all" ? null : ([query.status] as TaskStatus[]);
      const rows = await ports.store.listTasks(userId, {
        statuses,
        cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
        take: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const nextCursor =
        rows.length > query.limit
          ? encodeCursor({
              position: page[page.length - 1].position,
              id: page[page.length - 1].id,
            })
          : null;
      return { tasks: page.map(toPublicTask), nextCursor };
    },

    async get(userId: string, id: unknown): Promise<PublicTask> {
      return toPublicTask(await scoped(id as string, userId));
    },

    async update(userId: string, id: unknown, input: unknown): Promise<PublicTask> {
      const data = parse(updateTaskSchema, input);
      const taskId = parse(taskIdParamSchema, id);
      const row = await scoped(taskId, userId);
      await assertUnlocked(userId, taskId);
      // Lifecycle invariant (spec §8.2): archiving hides *active* work.
      // Only active tasks archive (completed_at is always null there, so no
      // completion record can strand on an archived row); completed tasks
      // leave the active view on their own and are hidden via delete, which
      // preserves their completion stamp for analytics. Reopening stays
      // explicit via POST :id/reopen, so PATCH can never set active on a
      // completed task either.
      if (data.status !== undefined) {
        if (row.status === "completed" && data.status === "active") {
          throw new TaskServiceError(
            "VALIDATION_ERROR",
            "Reopen completed tasks from the task menu instead.",
            { status: ["Reopen completed tasks from the task menu instead."] },
          );
        }
        if (row.status === "completed" && data.status === "archived") {
          throw new TaskServiceError(
            "VALIDATION_ERROR",
            "Completed tasks leave the active view on their own.",
            { status: ["Delete the task to hide it."] },
          );
        }
      }
      const patch: Partial<
        Pick<TaskRow, "title" | "notes" | "category" | "status" | "completedAt">
      > = {};
      if (data.title !== undefined) patch.title = data.title;
      if (data.notes !== undefined) patch.notes = data.notes ?? null;
      if (data.category !== undefined) patch.category = data.category ?? null;
      if (data.status !== undefined) patch.status = data.status;
      return toPublicTask(await ports.store.updateTask(taskId, userId, patch));
    },

    async complete(userId: string, id: unknown): Promise<PublicTask> {
      const taskId = parse(taskIdParamSchema, id);
      const row = await scoped(taskId, userId);
      await assertUnlocked(userId, taskId);
      if (row.status === "completed") return toPublicTask(row);
      if (row.status === "archived") {
        throw new TaskServiceError(
          "VALIDATION_ERROR",
          "Unarchive the task before completing it.",
          { status: ["Unarchive the task before completing it."] },
        );
      }
      return toPublicTask(
        await ports.store.updateTask(taskId, userId, {
          status: "completed",
          completedAt: ports.now(),
        }),
      );
    },

    async reopen(userId: string, id: unknown): Promise<PublicTask> {
      const taskId = parse(taskIdParamSchema, id);
      const row = await scoped(taskId, userId);
      await assertUnlocked(userId, taskId);
      if (row.status === "archived") {
        throw new TaskServiceError(
          "VALIDATION_ERROR",
          "Unarchive the task before reopening it.",
          { status: ["Unarchive the task before reopening it."] },
        );
      }
      if (row.status === "active" && row.completedAt === null) {
        return toPublicTask(row);
      }
      return toPublicTask(
        await ports.store.updateTask(taskId, userId, {
          status: "active",
          completedAt: null,
        }),
      );
    },

    async remove(userId: string, id: unknown): Promise<PublicTask> {
      const taskId = parse(taskIdParamSchema, id);
      const row = await ports.store.findTask(taskId, userId);
      if (!row) throw new TaskServiceError("NOT_FOUND", "Not found.");
      if (row.deletedAt !== null) return toPublicTask(row);
      await assertUnlocked(userId, taskId);
      return toPublicTask(
        await ports.store.softDeleteWithSnapshots(taskId, userId, ports.now()),
      );
    },

    async reorder(userId: string, input: unknown): Promise<PublicTask[]> {
      const { taskIds } = parse(reorderTasksSchema, input);
      // Leak-free first: every id resolves scoped — foreign or missing ids
      // read as NOT_FOUND before any other check runs.
      const rows = new Map<string, TaskRow>();
      for (const taskId of taskIds) {
        const row = await ports.store.findTask(taskId, userId);
        if (!row) throw new TaskServiceError("NOT_FOUND", "Not found.");
        rows.set(taskId, row);
      }
      const locked = await ports.store.lockedTaskId(userId);
      if (locked !== null && taskIds.includes(locked)) {
        throw new TaskServiceError(
          "TASK_LOCKED_BY_TIMER",
          "Finish or cancel the current interval before reordering this task.",
        );
      }
      for (const taskId of taskIds) {
        const row = rows.get(taskId)!;
        if (row.status !== "active" || row.deletedAt !== null) {
          throw new TaskServiceError(
            "VALIDATION_ERROR",
            "Only active tasks can be reordered.",
            { taskIds: ["Only active tasks can be reordered."] },
          );
        }
      }
      // Full-order contract: the client sends the complete active set, so a
      // reorder round-trip is exactly reproducible (issue acceptance:
      // "Position survives reorder round-trips").
      const activeIds = await ports.store.activeTaskIds(userId);
      const sameMembers =
        activeIds.length === taskIds.length &&
        taskIds.every((taskId) => activeIds.includes(taskId));
      if (!sameMembers) {
        throw new TaskServiceError(
          "VALIDATION_ERROR",
          "Send the complete active task order.",
          { taskIds: ["Send the complete active task order."] },
        );
      }
      const updated = await ports.store.reorderTasks(
        userId,
        taskIds.map((taskId, index) => ({
          id: taskId,
          position: (index + 1) * TASK_POSITION_STEP,
        })),
      );
      return updated.map(toPublicTask);
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
