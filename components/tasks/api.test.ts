import { describe, expect, it, vi, afterEach } from "vitest";
import {
  TaskApiError,
  archiveTask,
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  reopenTask,
  reorderTasks,
  updateTask,
} from "./api";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Write launch notes",
    notes: null,
    category: null,
    status: "active",
    position: 1000,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("tasks api client (seam A: fetch wrapper over /api/tasks)", () => {
  it("lists active tasks by default", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ tasks: [taskRow()], nextCursor: null }, 200),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await listTasks("active");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks?status=active",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.tasks).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("creates a task with a POST envelope", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ task: taskRow() }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);
    const task = await createTask({ title: "Write launch notes" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({ method: "POST" }),
    );
    expect(task.title).toBe("Write launch notes");
  });

  it("maps validation 400s onto code + field map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Check the highlighted fields and try again.",
              fields: { title: ["Enter a task title."] },
            },
          },
          400,
        ),
      ),
    );
    const failure = await createTask({ title: "  " }).catch((e) => e);
    expect(failure).toBeInstanceOf(TaskApiError);
    expect(failure.code).toBe("VALIDATION_ERROR");
    expect(failure.fields).toEqual({ title: ["Enter a task title."] });
  });

  it("surfaces the timer-lock 409 message for complete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "TASK_LOCKED_BY_TIMER",
              message:
                "Finish or cancel the current interval before changing this task.",
            },
          },
          409,
        ),
      ),
    );
    const failure = await completeTask(taskRow().id).catch((e) => e);
    expect(failure).toBeInstanceOf(TaskApiError);
    expect(failure.code).toBe("TASK_LOCKED_BY_TIMER");
    expect(failure.message).toMatch(/finish or cancel/i);
  });

  it("reads a leak-free 404 as NOT_FOUND", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { code: "NOT_FOUND", message: "Not found." } }, 404),
      ),
    );
    const failure = await deleteTask(taskRow().id).catch((e) => e);
    expect(failure).toBeInstanceOf(TaskApiError);
    expect(failure.code).toBe("NOT_FOUND");
  });

  it("reads an unauthenticated 401 as UNAUTHENTICATED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } },
          401,
        ),
      ),
    );
    const failure = await listTasks("active").catch((e) => e);
    expect(failure).toBeInstanceOf(TaskApiError);
    expect(failure.code).toBe("UNAUTHENTICATED");
  });

  it("maps network failure onto a retryable message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const failure = await listTasks("active").catch((e) => e);
    expect(failure).toBeInstanceOf(TaskApiError);
    expect(failure.message).toMatch(/connection/i);
  });

  it("updates, reopens, archives, and reorders over the documented routes", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        if (url.endsWith("/reorder"))
          return jsonResponse({ tasks: [taskRow()] }, 200);
        return jsonResponse({ task: taskRow() }, 200);
      }),
    );
    const id = taskRow().id;
    await updateTask(id, { title: "Renamed" });
    await reopenTask(id);
    await archiveTask(id);
    await reorderTasks([id]);
    expect(calls.map(([url]) => url)).toEqual([
      `/api/tasks/${id}`,
      `/api/tasks/${id}/reopen`,
      `/api/tasks/${id}`,
      "/api/tasks/reorder",
    ]);
    expect(calls.map(([, init]) => init?.method)).toEqual([
      "PATCH",
      "POST",
      "PATCH",
      "POST",
    ]);
  });
});
