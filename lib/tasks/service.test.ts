import { describe, expect, it } from "vitest";
import {
  TaskServiceError,
  createTaskService,
  decodeCursor,
  encodeCursor,
  type TaskPorts,
  type TaskRow,
  type TaskSessionRow,
} from "./service";

/**
 * Seam 2 (unit, hermetic): task domain logic over an in-memory fake store.
 * No Prisma, no HTTP — behavior proven through the service interface with
 * fixed literals (positions 1000/2000, fixed UUIDs where order matters).
 */
function uuid(): string {
  return crypto.randomUUID();
}

interface FakeDb {
  tasks: TaskRow[];
  sessions: TaskSessionRow[];
}

function fakePorts(db: FakeDb, now = new Date("2026-09-09T12:00:00.000Z")): TaskPorts {
  return {
    now: () => now,
    store: {
      async highestPosition(userId) {
        const visible = db.tasks.filter(
          (t) => t.userId === userId && t.deletedAt === null,
        );
        if (visible.length === 0) return null;
        return Math.max(...visible.map((t) => t.position));
      },
      async createTask(data) {
        const row: TaskRow = {
          id: uuid(),
          userId: data.userId,
          title: data.title,
          notes: data.notes ?? null,
          category: data.category ?? null,
          status: "active",
          position: data.position,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          deletedAt: null,
        };
        db.tasks.push(row);
        return row;
      },
      async findTask(id, userId) {
        return db.tasks.find((t) => t.id === id && t.userId === userId) ?? null;
      },
      async listTasks(userId, filter) {
        const statuses = filter.statuses;
        let rows = db.tasks
          .filter((t) => t.userId === userId && t.deletedAt === null)
          .filter((t) => !statuses || statuses.includes(t.status))
          .sort((a, b) =>
            a.position === b.position
              ? a.id.localeCompare(b.id)
              : a.position - b.position,
          );
        if (filter.cursor) {
          rows = rows.filter(
            (t) =>
              t.position > filter.cursor!.position ||
              (t.position === filter.cursor!.position &&
                t.id.localeCompare(filter.cursor!.id) > 0),
          );
        }
        return rows.slice(0, filter.take);
      },
      async updateTask(id, userId, data) {
        const row = db.tasks.find((t) => t.id === id && t.userId === userId);
        if (!row) throw new Error("fake: missing row");
        Object.assign(row, data, { updatedAt: now });
        return row;
      },
      async softDeleteWithSnapshots(id, userId, at) {
        const row = db.tasks.find((t) => t.id === id && t.userId === userId);
        if (!row) throw new Error("fake: missing row");
        row.deletedAt = at;
        row.updatedAt = at;
        for (const s of db.sessions) {
          if (s.userId === userId && s.taskId === row.id) {
            if (s.taskTitleSnapshot === null) s.taskTitleSnapshot = row.title;
            if (s.categorySnapshot === null) s.categorySnapshot = row.category;
          }
        }
        return row;
      },
      async activeTaskIds(userId) {
        return db.tasks
          .filter(
            (t) =>
              t.userId === userId &&
              t.status === "active" &&
              t.deletedAt === null,
          )
          .map((t) => t.id);
      },
      async reorderTasks(_userId, positions) {
        const out: TaskRow[] = [];
        for (const { id, position } of positions) {
          const row = db.tasks.find((t) => t.id === id);
          if (!row) throw new Error("fake: missing row");
          row.position = position;
          row.updatedAt = now;
          out.push(row);
        }
        return out;
      },
      async lockedTaskId(userId) {
        const active = db.sessions.find(
          (s) =>
            s.userId === userId &&
            (s.status === "running" || s.status === "paused") &&
            s.taskId !== null,
        );
        return active?.taskId ?? null;
      },
    },
  };
}

function setup() {
  const db: FakeDb = { tasks: [], sessions: [] };
  const service = createTaskService(fakePorts(db));
  return { db, service };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TaskServiceError);
    return (error as TaskServiceError).code;
  }
  throw new Error("expected a TaskServiceError");
}

describe("cursor codec", () => {
  it("round-trips a page position opaquely (no task content inside)", () => {
    const id = uuid();
    const token = encodeCursor({ position: 2000, id });
    expect(token).not.toContain(id);
    expect(token).not.toContain("2000");
    expect(decodeCursor(token)).toEqual({ position: 2000, id });
  });

  it("rejects forged cursors as validation failures, never crashes", () => {
    for (const bad of ["", "!!!", "aGk=", "e30="]) {
      expect(() => decodeCursor(bad)).toThrowError(TaskServiceError);
      try {
        decodeCursor(bad);
      } catch (error) {
        expect((error as TaskServiceError).code).toBe("VALIDATION_ERROR");
      }
    }
  });
});

describe("create", () => {
  it("assigns stepped positions per user (1000, then 2000)", async () => {
    const { service } = setup();
    const first = await service.create("user-a", { title: "First" });
    const second = await service.create("user-a", { title: "Second" });
    const other = await service.create("user-b", { title: "Other" });
    expect(first.position).toBe(1000);
    expect(second.position).toBe(2000);
    expect(other.position).toBe(1000);
    expect(first.createdAt).toBe("2026-09-09T12:00:00.000Z");
  });

  it("rejects blank and overlong titles without touching the store", async () => {
    const { db, service } = setup();
    expect(await codeOf(service.create("u", { title: "   " }))).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      await codeOf(service.create("u", { title: "x".repeat(201) })),
    ).toBe("VALIDATION_ERROR");
    expect(db.tasks).toHaveLength(0);
  });
});

describe("list", () => {
  it("shows active tasks in position order, hiding completed and deleted", async () => {
    const { db, service } = setup();
    const a = await service.create("u", { title: "A" });
    const b = await service.create("u", { title: "B" });
    await service.complete("u", a.id);
    const deleted = await service.create("u", { title: "Gone" });
    await service.remove("u", deleted.id);
    void b;

    const active = await service.list("u", {});
    expect(active.tasks.map((t) => t.title)).toEqual(["B"]);
    const completed = await service.list("u", { status: "completed" });
    expect(completed.tasks.map((t) => t.title)).toEqual(["A"]);
    const all = await service.list("u", { status: "all" });
    expect(all.tasks.map((t) => t.title).sort()).toEqual(["A", "B"]);
    expect(db.tasks).toHaveLength(3);
  });

  it("paginates with opaque cursors (limit 1 over two tasks)", async () => {
    const { service } = setup();
    await service.create("u", { title: "First" });
    await service.create("u", { title: "Second" });

    const page1 = await service.list("u", { limit: 1 });
    expect(page1.tasks.map((t) => t.title)).toEqual(["First"]);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await service.list("u", {
      limit: 1,
      cursor: page1.nextCursor!,
    });
    expect(page2.tasks.map((t) => t.title)).toEqual(["Second"]);
    expect(page2.nextCursor).toBeNull();
  });

  it("rejects forged cursors and unknown statuses", async () => {
    const { service } = setup();
    expect(await codeOf(service.list("u", { cursor: "bogus" }))).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      await codeOf(service.list("u", { status: "deleted" as never })),
    ).toBe("VALIDATION_ERROR");
  });
});

describe("get", () => {
  it("returns the task, and hides foreign or deleted tasks as NOT_FOUND", async () => {
    const { service } = setup();
    const task = await service.create("owner", { title: "Mine" });
    expect((await service.get("owner", task.id)).title).toBe("Mine");
    expect(await codeOf(service.get("stranger", task.id))).toBe("NOT_FOUND");
    await service.remove("owner", task.id);
    expect(await codeOf(service.get("owner", task.id))).toBe("NOT_FOUND");
  });
});

describe("update", () => {
  it("edits title/notes/category and archives + unarchives", async () => {
    const { service } = setup();
    const task = await service.create("u", { title: "Old" });
    const edited = await service.update("u", task.id, {
      title: "New",
      notes: "details",
      category: "work",
    });
    expect(edited).toMatchObject({
      title: "New",
      notes: "details",
      category: "work",
    });
    const archived = await service.update("u", task.id, {
      status: "archived",
    });
    expect(archived.status).toBe("archived");
    const back = await service.update("u", task.id, { status: "active" });
    expect(back.status).toBe("active");
  });

  it("refuses foreign tasks, locked tasks, empty patches, and patch-to-active on completed", async () => {
    const { db, service } = setup();
    const task = await service.create("owner", { title: "Mine" });
    expect(await codeOf(service.update("stranger", task.id, { title: "X" }))).toBe(
      "NOT_FOUND",
    );
    expect(await codeOf(service.update("owner", task.id, {}))).toBe(
      "VALIDATION_ERROR",
    );
    db.sessions.push({
      id: uuid(),
      userId: "owner",
      taskId: task.id,
      status: "running",
      taskTitleSnapshot: null,
      categorySnapshot: null,
    });
    expect(await codeOf(service.update("owner", task.id, { title: "Y" }))).toBe(
      "TASK_LOCKED_BY_TIMER",
    );
    db.sessions.length = 0;
    await service.complete("owner", task.id);
    expect(
      await codeOf(service.update("owner", task.id, { status: "active" })),
    ).toBe("VALIDATION_ERROR");
  });
});

describe("archive lifecycle", () => {
  it("archives active tasks only; completed tasks archive via delete, never via patch", async () => {
    const { service } = setup();
    const task = await service.create("u", { title: "Later" });
    expect((await service.update("u", task.id, { status: "archived" })).status).toBe("archived");
    expect((await service.update("u", task.id, { status: "active" })).status).toBe("active");
    await service.complete("u", task.id);
    // Completed tasks cannot be archived: archiving would hide the
    // completion record while keeping the row — delete preserves it.
    expect(await codeOf(service.update("u", task.id, { status: "archived" }))).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("refuses complete/reopen on archived tasks (unarchive first)", async () => {
    const { service } = setup();
    const task = await service.create("u", { title: "Later" });
    await service.update("u", task.id, { status: "archived" });
    expect(await codeOf(service.complete("u", task.id))).toBe("VALIDATION_ERROR");
    expect(await codeOf(service.reopen("u", task.id))).toBe("VALIDATION_ERROR");
    // Unarchiving restores the exact active task (no stale stamp possible:
    // only active tasks, which never carry one, can be archived).
    const back = await service.update("u", task.id, { status: "active" });
    expect(back).toMatchObject({ status: "active", completedAt: null });
  });
});

describe("complete / reopen", () => {
  it("completes with a timestamp and reopens by clearing it", async () => {
    const { service } = setup();
    const task = await service.create("u", { title: "Work" });
    const done = await service.complete("u", task.id);
    expect(done.status).toBe("completed");
    expect(done.completedAt).toBe("2026-09-09T12:00:00.000Z");
    // Idempotent: completing twice keeps one timestamp.
    expect((await service.complete("u", task.id)).completedAt).toBe(
      "2026-09-09T12:00:00.000Z",
    );
    const open = await service.reopen("u", task.id);
    expect(open.status).toBe("active");
    expect(open.completedAt).toBeNull();
    // Idempotent: reopening an active task is a no-op.
    expect((await service.reopen("u", task.id)).status).toBe("active");
  });

  it("locks completed-state changes while the interval runs, 404s foreign tasks", async () => {
    const { db, service } = setup();
    const task = await service.create("owner", { title: "Mine" });
    db.sessions.push({
      id: uuid(),
      userId: "owner",
      taskId: task.id,
      status: "paused",
      taskTitleSnapshot: null,
      categorySnapshot: null,
    });
    expect(await codeOf(service.complete("owner", task.id))).toBe(
      "TASK_LOCKED_BY_TIMER",
    );
    db.sessions.length = 0;
    expect(await codeOf(service.complete("stranger", task.id))).toBe("NOT_FOUND");
    expect(await codeOf(service.reopen("stranger", task.id))).toBe("NOT_FOUND");
  });
});

describe("remove", () => {
  it("soft-deletes (gone from lists, kept in store) and backfills session snapshots", async () => {
    const { db, service } = setup();
    const task = await service.create("u", {
      title: "Trip",
      category: "travel",
    });
    db.sessions.push({
      id: uuid(),
      userId: "u",
      taskId: task.id,
      status: "completed",
      taskTitleSnapshot: null,
      categorySnapshot: null,
    });
    const removed = await service.remove("u", task.id);
    expect(removed.deletedAt).toBe("2026-09-09T12:00:00.000Z");
    expect(await service.list("u", {})).toMatchObject({ tasks: [] });
    expect(db.tasks).toHaveLength(1);
    expect(db.sessions[0]).toMatchObject({
      taskTitleSnapshot: "Trip",
      categorySnapshot: "travel",
    });
    // Idempotent: deleting twice succeeds with the same stamp.
    expect((await service.remove("u", task.id)).deletedAt).toBe(
      "2026-09-09T12:00:00.000Z",
    );
  });

  it("refuses foreign deletes and locked-task deletes", async () => {
    const { db, service } = setup();
    const task = await service.create("owner", { title: "Mine" });
    expect(await codeOf(service.remove("stranger", task.id))).toBe("NOT_FOUND");
    db.sessions.push({
      id: uuid(),
      userId: "owner",
      taskId: task.id,
      status: "running",
      taskTitleSnapshot: null,
      categorySnapshot: null,
    });
    expect(await codeOf(service.remove("owner", task.id))).toBe(
      "TASK_LOCKED_BY_TIMER",
    );
  });
});

describe("reorder", () => {
  it("persists a new order that survives a re-list round-trip", async () => {
    const { service } = setup();
    const a = await service.create("u", { title: "A" });
    const b = await service.create("u", { title: "B" });
    const c = await service.create("u", { title: "C" });
    const reordered = await service.reorder("u", {
      taskIds: [c.id, a.id, b.id],
    });
    expect(reordered.map((t) => t.title)).toEqual(["C", "A", "B"]);
    const relisted = await service.list("u", {});
    expect(relisted.tasks.map((t) => t.title)).toEqual(["C", "A", "B"]);
  });

  it("rejects foreign ids as NOT_FOUND and partial sets as validation failures", async () => {
    const { service } = setup();
    const a = await service.create("owner", { title: "A" });
    const b = await service.create("owner", { title: "B" });
    expect(
      await codeOf(service.reorder("stranger", { taskIds: [a.id, b.id] })),
    ).toBe("NOT_FOUND");
    expect(await codeOf(service.reorder("owner", { taskIds: [a.id] }))).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      await codeOf(
        service.reorder("owner", { taskIds: [a.id, b.id, uuid()] }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("refuses to reorder while a listed task has an active interval", async () => {
    const { db, service } = setup();
    const a = await service.create("u", { title: "A" });
    const b = await service.create("u", { title: "B" });
    db.sessions.push({
      id: uuid(),
      userId: "u",
      taskId: a.id,
      status: "running",
      taskTitleSnapshot: "A",
      categorySnapshot: null,
    });
    expect(
      await codeOf(service.reorder("u", { taskIds: [b.id, a.id] })),
    ).toBe("TASK_LOCKED_BY_TIMER");
  });
});
