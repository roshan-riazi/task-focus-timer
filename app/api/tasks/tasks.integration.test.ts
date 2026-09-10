import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createCompleteTaskHandler,
  createCreateTaskHandler,
  createDeleteTaskHandler,
  createGetTaskHandler,
  createListTasksHandler,
  createPatchTaskHandler,
  createReopenTaskHandler,
  createReorderTasksHandler,
  type TaskHandlerDeps,
} from "@/lib/tasks/handlers";
import { createPrismaTaskStore } from "@/lib/tasks/prisma-store";
import { createTaskService, type TaskService } from "@/lib/tasks/service";
import type { AppSession } from "@/lib/auth/session";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

const APP_URL = "http://localhost:3000";

/**
 * Issue 07 acceptance against live Postgres (TEST_STRATEGY §2, API level):
 *
 * - Full lifecycle through the HTTP seam: create → listed → fresh-session
 *   read (the logout/login story: persistence is session-independent) →
 *   patch → complete → reopen → reorder round-trip → delete.
 * - Active/completed filters with opaque cursor pagination.
 * - Delete with sessions: task leaves every list, snapshots stay legible.
 * - Locked-task 409 on every mutation while an interval runs; reads pass.
 * - Per-user scoping on every route, both directions (foreign reads as
 *   NOT_FOUND — never a hint that another user's row exists).
 */
describeIfDb(
  "task API (live Postgres)",
  () => {
    let db: PrismaClient;
    let service: TaskService;
    const createdUserIds: string[] = [];

    async function setup(): Promise<void> {
      const mod = await import("@/lib/db");
      db = mod.db;
      service = createTaskService({
        now: () => new Date("2026-09-09T12:00:00.000Z"),
        store: createPrismaTaskStore(db),
      });
    }

    function email(prefix: string): string {
      return `${prefix}-${crypto.randomUUID()}@example.com`;
    }

    async function makeUser(prefix: string): Promise<{ id: string; email: string }> {
      const address = email(prefix);
      const user = await db.user.create({ data: { email: address } });
      createdUserIds.push(user.id);
      return { id: user.id, email: address };
    }

    function depsFor(userId: string, userEmail: string): TaskHandlerDeps {
      const session: AppSession = {
        user: { id: userId, email: userEmail, emailVerified: null, timezone: "UTC" },
        expires: new Date("2026-10-09T12:00:00.000Z").toISOString(),
      };
      return {
        getService: async () => service,
        getSession: async () => session,
        appUrl: APP_URL,
      };
    }

    function get(deps: TaskHandlerDeps, path: string): Promise<Response> {
      return createListTasksHandler(deps)(
        new Request(`${APP_URL}${path}`, { method: "GET" }),
      );
    }

    function post(
      handler: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>,
      deps: TaskHandlerDeps,
      body: unknown,
      id?: string,
      method = "POST",
    ): Promise<Response> {
      return handler(
        new Request(`${APP_URL}/api/tasks/${id ?? ""}`, {
          method,
          headers: { "content-type": "application/json", origin: APP_URL },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: id ?? "" }) },
      );
    }

    function getOne(deps: TaskHandlerDeps, id: string): Promise<Response> {
      return createGetTaskHandler(deps)(
        new Request(`${APP_URL}/api/tasks/${id}`, { method: "GET" }),
        { params: Promise.resolve({ id }) },
      );
    }

    type TaskBody = {
      id: string;
      title: string;
      status: string;
      position: number;
      completedAt: string | null;
      deletedAt: string | null;
    };

    async function createTask(
      deps: TaskHandlerDeps,
      body: unknown,
    ): Promise<{ status: number; task?: TaskBody; raw: Response }> {
      const raw = await createCreateTaskHandler(deps)(
        new Request(`${APP_URL}/api/tasks`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: APP_URL },
          body: JSON.stringify(body),
        }),
      );
      const json = (await raw.json()) as { task?: TaskBody };
      return { status: raw.status, task: json.task, raw };
    }

    afterEach(async () => {
      if (db) {
        // Users cascade to tasks, sessions, settings, and cycle state.
        await db.user.deleteMany({
          where: { id: { in: createdUserIds.splice(0) } },
        });
      }
    });

    it("runs the full lifecycle through the HTTP seam", async () => {
      await setup();
      const user = await makeUser("lifecycle");
      const deps = depsFor(user.id, user.email);

      // Create → 201 with a stepped position.
      const created = await createTask(deps, {
        title: "Write report",
        category: "work",
      });
      expect(created.status).toBe(201);
      const id = created.task!.id;
      expect(created.task).toMatchObject({ title: "Write report", status: "active" });

      // Listed on the default (active) view.
      const listed = (await (await get(deps, "/api/tasks")).json()) as {
        tasks: TaskBody[];
        nextCursor: null;
      };
      expect(listed.tasks.map((t) => t.id)).toContain(id);

      // Fresh deps for the same user (the logout/login story: a new
      // session over the same identity) still read the task.
      const fresh = depsFor(user.id, user.email);
      expect(((await (await getOne(fresh, id)).json()) as { task: TaskBody }).task.title).toBe(
        "Write report",
      );

      // Patch → complete → reopen.
      const patched = await post(createPatchTaskHandler(deps), deps, { title: "Write report v2" }, id, "PATCH");
      expect(patched.status).toBe(200);
      expect(((await patched.json()) as { task: TaskBody }).task.title).toBe("Write report v2");

      const done = await post(createCompleteTaskHandler(deps), deps, {}, id);
      expect(((await done.json()) as { task: TaskBody }).task.status).toBe("completed");
      expect(
        ((await (await get(deps, "/api/tasks?status=completed")).json()) as { tasks: TaskBody[] }).tasks.map(
          (t) => t.id,
        ),
      ).toContain(id);

      const open = await post(createReopenTaskHandler(deps), deps, {}, id);
      expect(((await open.json()) as { task: TaskBody }).task.status).toBe("active");

      // Second task + reorder round-trip: the new order survives a re-list.
      const second = await createTask(deps, { title: "Second" });
      const reordered = await createReorderTasksHandler(deps)(
        new Request(`${APP_URL}/api/tasks/reorder`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: APP_URL },
          body: JSON.stringify({ taskIds: [second.task!.id, id] }),
        }),
      );
      expect(reordered.status).toBe(200);
      const relisted = (await (await get(deps, "/api/tasks")).json()) as { tasks: TaskBody[] };
      expect(relisted.tasks.map((t) => t.id)).toEqual([second.task!.id, id]);
      const positions = relisted.tasks.map((t) => t.position);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);

      // Delete → gone from every list, second delete idempotent.
      const removed = await post(createDeleteTaskHandler(deps), deps, {}, id, "DELETE");
      expect(removed.status).toBe(200);
      expect(
        ((await (await get(deps, "/api/tasks")).json()) as { tasks: TaskBody[] }).tasks.map(
          (t) => t.id,
        ),
      ).not.toContain(id);
      expect((await getOne(deps, id)).status).toBe(404);
      expect((await post(createDeleteTaskHandler(deps), deps, {}, id, "DELETE")).status).toBe(200);
    });

    it("paginates completed tasks with opaque cursors", async () => {
      await setup();
      const user = await makeUser("pages");
      const deps = depsFor(user.id, user.email);

      const titles = ["One", "Two", "Three"];
      for (const title of titles) {
        const created = await createTask(deps, { title });
        await post(createCompleteTaskHandler(deps), deps, {}, created.task!.id);
      }

      const page1 = (await (
        await get(deps, "/api/tasks?status=completed&limit=1")
      ).json()) as { tasks: TaskBody[]; nextCursor: string };
      expect(page1.tasks).toHaveLength(1);
      expect(page1.tasks[0].title).toBe("One");
      expect(typeof page1.nextCursor).toBe("string");

      const page2 = (await (
        await get(deps, `/api/tasks?status=completed&limit=1&cursor=${page1.nextCursor}`)
      ).json()) as { tasks: TaskBody[]; nextCursor: string };
      expect(page2.tasks.map((t) => t.title)).toEqual(["Two"]);

      const page3 = (await (
        await get(deps, `/api/tasks?status=completed&limit=1&cursor=${page2.nextCursor}`)
      ).json()) as { tasks: TaskBody[]; nextCursor: null };
      expect(page3.tasks.map((t) => t.title)).toEqual(["Three"]);
      expect(page3.nextCursor).toBeNull();

      // Forged cursors and bad input fail as 400s, never 500s.
      expect((await get(deps, "/api/tasks?cursor=bogus")).status).toBe(400);
      expect((await get(deps, "/api/tasks?status=deleted")).status).toBe(400);
      expect((await createTask(deps, { title: "   " })).status).toBe(400);
      expect((await createTask(deps, { title: "x".repeat(201) })).status).toBe(400);
    });

    it("keeps archived tasks out of complete/reopen until unarchived", async () => {
      await setup();
      const user = await makeUser("archived");
      const deps = depsFor(user.id, user.email);

      const created = await createTask(deps, { title: "Later" });
      const id = created.task!.id;
      expect(
        (await post(createPatchTaskHandler(deps), deps, { status: "archived" }, id, "PATCH")).status,
      ).toBe(200);
      // Archived work completes and reopens only after unarchiving.
      expect((await post(createCompleteTaskHandler(deps), deps, {}, id)).status).toBe(400);
      expect((await post(createReopenTaskHandler(deps), deps, {}, id)).status).toBe(400);
      expect(
        (await post(createPatchTaskHandler(deps), deps, { status: "active" }, id, "PATCH")).status,
      ).toBe(200);
      expect((await post(createCompleteTaskHandler(deps), deps, {}, id)).status).toBe(200);
      // Completed tasks hide via delete, never via archive.
      const done = await createTask(deps, { title: "Done hiding" });
      await post(createCompleteTaskHandler(deps), deps, {}, done.task!.id);
      expect(
        (await post(createPatchTaskHandler(deps), deps, { status: "archived" }, done.task!.id, "PATCH"))
          .status,
      ).toBe(400);
    });

    it("keeps session snapshots when a task with history is deleted", async () => {
      await setup();
      const user = await makeUser("snapshots");
      const deps = depsFor(user.id, user.email);

      const created = await createTask(deps, { title: "Trip", category: "travel" });
      const id = created.task!.id;
      await db.timerSession.create({
        data: {
          userId: user.id,
          taskId: id,
          intervalType: "focus",
          status: "completed",
          plannedDurationSeconds: 1500,
          actualDurationSeconds: 1500,
          startedAt: new Date("2026-09-08T10:00:00.000Z"),
          expectedEndAt: new Date("2026-09-08T10:25:00.000Z"),
          completedAt: new Date("2026-09-08T10:25:00.000Z"),
        },
      });

      expect((await post(createDeleteTaskHandler(deps), deps, {}, id, "DELETE")).status).toBe(200);
      const sessions = await db.timerSession.findMany({ where: { userId: user.id } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        taskTitleSnapshot: "Trip",
        categorySnapshot: "travel",
      });
    });

    it("locks every mutation while the interval runs, but never reads", async () => {
      await setup();
      const user = await makeUser("locked");
      const deps = depsFor(user.id, user.email);

      const first = await createTask(deps, { title: "Focus me" });
      const second = await createTask(deps, { title: "Other" });
      const id = first.task!.id;
      await db.timerSession.create({
        data: {
          userId: user.id,
          taskId: id,
          intervalType: "focus",
          status: "running",
          plannedDurationSeconds: 1500,
          startedAt: new Date("2026-09-09T11:50:00.000Z"),
          expectedEndAt: new Date("2026-09-09T12:15:00.000Z"),
        },
      });

      const codes: number[] = [];
      codes.push((await post(createPatchTaskHandler(deps), deps, { title: "Changed" }, id, "PATCH")).status);
      codes.push((await post(createCompleteTaskHandler(deps), deps, {}, id)).status);
      codes.push((await post(createReopenTaskHandler(deps), deps, {}, id)).status);
      codes.push((await post(createDeleteTaskHandler(deps), deps, {}, id, "DELETE")).status);
      const reorderLocked = await createReorderTasksHandler(deps)(
        new Request(`${APP_URL}/api/tasks/reorder`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: APP_URL },
          body: JSON.stringify({ taskIds: [second.task!.id, id] }),
        }),
      );
      codes.push(reorderLocked.status);
      expect(codes).toEqual([409, 409, 409, 409, 409]);
      const lockedBody = (await (
        await post(createPatchTaskHandler(deps), deps, { title: "Changed" }, id, "PATCH")
      ).json()) as { error: { code: string } };
      expect(lockedBody.error.code).toBe("TASK_LOCKED_BY_TIMER");

      // Reads still pass, and the title is untouched.
      expect((await getOne(deps, id)).status).toBe(200);
      expect(((await (await getOne(deps, id)).json()) as { task: TaskBody }).task.title).toBe("Focus me");

      // Finalizing the interval unlocks the task.
      await db.timerSession.deleteMany({ where: { userId: user.id } });
      expect(
        (await post(createPatchTaskHandler(deps), deps, { title: "Changed" }, id, "PATCH")).status,
      ).toBe(200);
    });

    it("isolates every route by user, both directions", async () => {
      await setup();
      const a = await makeUser("scope-a");
      const b = await makeUser("scope-b");
      const depsA = depsFor(a.id, a.email);
      const depsB = depsFor(b.id, b.email);

      const owned = await createTask(depsA, { title: "A private" });
      const id = owned.task!.id;

      // B reaches nothing of A's: get/patch/complete/reopen/delete all 404.
      expect((await getOne(depsB, id)).status).toBe(404);
      expect((await post(createPatchTaskHandler(depsB), depsB, { title: "Hijack" }, id, "PATCH")).status).toBe(404);
      expect((await post(createCompleteTaskHandler(depsB), depsB, {}, id)).status).toBe(404);
      expect((await post(createReopenTaskHandler(depsB), depsB, {}, id)).status).toBe(404);
      expect((await post(createDeleteTaskHandler(depsB), depsB, {}, id, "DELETE")).status).toBe(404);

      // And the reverse: A's row is absent from B's lists entirely.
      const listB = (await (await get(depsB, "/api/tasks")).json()) as { tasks: TaskBody[] };
      expect(listB.tasks).toEqual([]);
      const bTask = await createTask(depsB, { title: "B private" });
      expect((await getOne(depsA, bTask.task!.id)).status).toBe(404);

      // Reorder with a foreign id reads as NOT_FOUND, and A's order is intact.
      const reorderForeign = await createReorderTasksHandler(depsB)(
        new Request(`${APP_URL}/api/tasks/reorder`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: APP_URL },
          body: JSON.stringify({ taskIds: [bTask.task!.id, id] }),
        }),
      );
      expect(reorderForeign.status).toBe(404);
      const listA = (await (await get(depsA, "/api/tasks")).json()) as { tasks: TaskBody[] };
      expect(listA.tasks.map((t) => t.title)).toEqual(["A private"]);

      // A's data survived B's probes untouched.
      expect(((await (await getOne(depsA, id)).json()) as { task: TaskBody }).task.title).toBe("A private");
    });

    it("requires a session on every route", async () => {
      await setup();
      const signedOut: TaskHandlerDeps = {
        getService: async () => service,
        getSession: async () => null,
        appUrl: APP_URL,
      };
      expect((await get(signedOut, "/api/tasks")).status).toBe(401);
      expect((await createTask(signedOut, { title: "X" })).status).toBe(401);
    });
  },
  60_000,
);
