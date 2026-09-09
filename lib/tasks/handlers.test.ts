import { describe, expect, it, vi } from "vitest";
import { sessionCookieName } from "../auth/cookies";
import type { AppSession } from "../auth/session";
import { TaskServiceError, type TaskService } from "./service";
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
} from "./handlers";

/**
 * Seam 3 (unit, hermetic): HTTP status codes, envelopes, and session
 * scoping at the task-route boundary. Every handler runs against a stub
 * service and a stub session reader — no Prisma, no Next.js. Live-DB
 * coverage of the same handlers lands in
 * app/api/tasks/tasks.integration.test.ts (CI + local Postgres).
 */
const APP_URL = "http://localhost:3000";

const appSession: AppSession = {
  user: {
    id: "user-1",
    email: "alice@example.com",
    emailVerified: null,
    timezone: "UTC",
  },
  expires: new Date("2026-10-09T12:00:00.000Z").toISOString(),
};

function stubService(overrides: Partial<TaskService> = {}): TaskService {
  const notImplemented = async (): Promise<never> => {
    throw new Error("not implemented in stub");
  };
  return {
    create: notImplemented,
    list: notImplemented,
    get: notImplemented,
    update: notImplemented,
    complete: notImplemented,
    reopen: notImplemented,
    remove: notImplemented,
    reorder: notImplemented,
    ...overrides,
  } as TaskService;
}

function deps(overrides: Partial<TaskHandlerDeps> = {}): TaskHandlerDeps {
  return {
    getService: async () => stubService(),
    getSession: async () => appSession,
    appUrl: APP_URL,
    ...overrides,
  };
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${APP_URL}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string) {
  return new Request(`${APP_URL}${path}`, { method: "GET" });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function sampleTask() {
  return {
    id: crypto.randomUUID(),
    title: "Write report",
    notes: null,
    category: null,
    status: "active" as const,
    position: 1000,
    createdAt: "2026-09-09T12:00:00.000Z",
    updatedAt: "2026-09-09T12:00:00.000Z",
    completedAt: null,
    deletedAt: null,
  };
}

describe("guard rails (every handler)", () => {
  it("returns 401 when signed out", async () => {
    const signedOut = deps({ getSession: async () => null });
    const id = crypto.randomUUID();
    expect(await createListTasksHandler(signedOut)(getRequest("/api/tasks"))).toMatchObject({ status: 401 });
    expect(await createCreateTaskHandler(signedOut)(jsonRequest({}))).toMatchObject({ status: 401 });
    expect(await createGetTaskHandler(signedOut)(getRequest(`/api/tasks/${id}`), params(id))).toMatchObject({ status: 401 });
    expect(await createPatchTaskHandler(signedOut)(jsonRequest({},), params(id))).toMatchObject({ status: 401 });
    expect(await createCompleteTaskHandler(signedOut)(jsonRequest({}), params(id))).toMatchObject({ status: 401 });
    expect(await createReopenTaskHandler(signedOut)(jsonRequest({}), params(id))).toMatchObject({ status: 401 });
    expect(await createDeleteTaskHandler(signedOut)(jsonRequest({}), params(id))).toMatchObject({ status: 401 });
    expect(await createReorderTasksHandler(signedOut)(jsonRequest({}))).toMatchObject({ status: 401 });
  });

  it("blocks cookie-bearing cross-origin mutations with 403", async () => {
    const handler = createCreateTaskHandler(
      deps({ getService: async () => stubService() }),
    );
    const res = await handler(
      jsonRequest(
        { title: "X" },
        {
          cookie: `${sessionCookieName()}=sess-abc`,
          origin: "https://evil.example",
        },
      ),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "ORIGIN_MISMATCH",
    );
  });

  it("maps unexpected failures to a leak-free 500", async () => {
    const handler = createListTasksHandler(
      deps({
        getService: async () => {
          throw new Error("connect ECONNREFUSED postgres://secret@db:5432");
        },
      }),
    );
    const res = await handler(getRequest("/api/tasks"));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("INTERNAL_ERROR");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("postgres://");
  });
});

describe("GET /api/tasks + POST /api/tasks", () => {
  it("lists with query passthrough and a null cursor on the last page", async () => {
    const task = sampleTask();
    const list = vi.fn(async () => ({ tasks: [task], nextCursor: null }));
    const handler = createListTasksHandler(
      deps({ getService: async () => stubService({ list }) }),
    );
    const res = await handler(
      getRequest("/api/tasks?status=completed&limit=25&cursor=abc"),
    );
    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledWith("user-1", {
      status: "completed",
      limit: "25",
      cursor: "abc",
    });
    expect(await res.json()).toEqual({ tasks: [task], nextCursor: null });
  });

  it("creates with 201 and scopes to the session user (forged body id ignored)", async () => {
    const task = sampleTask();
    const create = vi.fn(async () => task);
    const handler = createCreateTaskHandler(
      deps({ getService: async () => stubService({ create }) }),
    );
    const res = await handler(
      jsonRequest({ title: "Write report", userId: "victim-id" }),
    );
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith("user-1", {
      title: "Write report",
      userId: "victim-id",
    });
    expect(await res.json()).toEqual({ task });
  });

  it("maps service validation failures to the 400 field envelope", async () => {
    const handler = createCreateTaskHandler(
      deps({
        getService: async () =>
          stubService({
            create: async () => {
              throw new TaskServiceError("VALIDATION_ERROR", "Bad.", {
                title: ["Enter a task title."],
              });
            },
          }),
      }),
    );
    const res = await handler(jsonRequest({ title: "   " }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; fields: Record<string, string[]> };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.title).toHaveLength(1);
  });
});

describe("GET/PATCH /api/tasks/:id", () => {
  it("returns the scoped task", async () => {
    const task = sampleTask();
    const get = vi.fn(async () => task);
    const handler = createGetTaskHandler(
      deps({ getService: async () => stubService({ get }) }),
    );
    const res = await handler(
      getRequest(`/api/tasks/${task.id}`),
      params(task.id),
    );
    expect(res.status).toBe(200);
    expect(get).toHaveBeenCalledWith("user-1", task.id);
    expect(await res.json()).toEqual({ task });
  });

  it("reads foreign tasks as 404 (never forbidden-with-a-hint)", async () => {
    const handler = createGetTaskHandler(
      deps({
        getService: async () =>
          stubService({
            get: async () => {
              throw new TaskServiceError("NOT_FOUND", "Not found.");
            },
          }),
      }),
    );
    const id = crypto.randomUUID();
    const res = await handler(getRequest(`/api/tasks/${id}`), params(id));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("patches through the session user id", async () => {
    const task = { ...sampleTask(), title: "New" };
    const update = vi.fn(async () => task);
    const handler = createPatchTaskHandler(
      deps({ getService: async () => stubService({ update }) }),
    );
    const res = await handler(jsonRequest({ title: "New" }), params(task.id));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith("user-1", task.id, { title: "New" });
    expect(await res.json()).toEqual({ task });
  });
});

describe("POST /api/tasks/:id/complete + /reopen + DELETE", () => {
  it("completes, reopens, and deletes through the session user", async () => {
    const task = sampleTask();
    const id = task.id;
    const complete = vi.fn(async () => ({ ...task, status: "completed" as const }));
    const reopen = vi.fn(async () => task);
    const remove = vi.fn(async () => ({ ...task, deletedAt: "2026-09-09T12:00:00.000Z" }));
    const service = stubService({ complete, reopen, remove });
    const d = deps({ getService: async () => service });

    const done = await createCompleteTaskHandler(d)(jsonRequest({}), params(id));
    expect(done.status).toBe(200);
    expect(complete).toHaveBeenCalledWith("user-1", id);

    const open = await createReopenTaskHandler(d)(jsonRequest({}), params(id));
    expect(open.status).toBe(200);
    expect(reopen).toHaveBeenCalledWith("user-1", id);

    const gone = await createDeleteTaskHandler(d)(
      new Request(`${APP_URL}/api/tasks/${id}`, { method: "DELETE" }),
      params(id),
    );
    expect(gone.status).toBe(200);
    expect(remove).toHaveBeenCalledWith("user-1", id);
  });

  it("maps locked tasks to 409 with the stable code", async () => {
    const locked = async (): Promise<never> => {
      throw new TaskServiceError(
        "TASK_LOCKED_BY_TIMER",
        "Finish or cancel the current interval before changing this task.",
      );
    };
    const id = crypto.randomUUID();
    const d = deps({ getService: async () => stubService({ update: locked, remove: locked, complete: locked }) });
    const patched = await createPatchTaskHandler(d)(jsonRequest({ title: "X" }), params(id));
    expect(patched.status).toBe(409);
    expect(
      ((await patched.json()) as { error: { code: string } }).error.code,
    ).toBe("TASK_LOCKED_BY_TIMER");
    const removed = await createDeleteTaskHandler(d)(
      new Request(`${APP_URL}/api/tasks/${id}`, { method: "DELETE" }),
      params(id),
    );
    expect(removed.status).toBe(409);
  });
});

describe("POST /api/tasks/reorder", () => {
  it("returns the reordered list", async () => {
    const a = sampleTask();
    const b = { ...sampleTask(), title: "B" };
    const reorder = vi.fn(async () => [b, a]);
    const handler = createReorderTasksHandler(
      deps({ getService: async () => stubService({ reorder }) }),
    );
    const res = await handler(jsonRequest({ taskIds: [b.id, a.id] }));
    expect(res.status).toBe(200);
    expect(reorder).toHaveBeenCalledWith("user-1", { taskIds: [b.id, a.id] });
    expect(await res.json()).toEqual({ tasks: [b, a] });
  });
});
