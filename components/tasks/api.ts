import type { PublicTask } from "@/lib/tasks/service";

export type TaskFilter = "active" | "completed" | "archived" | "all";

export interface CreateTaskValues {
  title: string;
  notes?: string;
  category?: string;
}

export interface UpdateTaskValues {
  title?: string;
  notes?: string | null;
  category?: string | null;
}

/**
 * Typed client failure for the Task API envelope
 * (`{ error: { code, message, fields? } }`, SYSTEM_DESIGN §6). Carries the
 * machine code so the UI can branch (locked-task messaging, sign-in
 * redirect) while showing the server message verbatim. Never logs task
 * content — errors carry display strings only.
 */
export class TaskApiError extends Error {
  readonly fields: Record<string, string[]>;
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "TaskApiError";
    this.fields = fields ?? {};
  }
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
}

/** Catch-all for non-envelope throws (network, bugs): retryable message. */
export function toTaskApiError(error: unknown): TaskApiError {
  return error instanceof TaskApiError
    ? error
    : new TaskApiError(
        "NETWORK_ERROR",
        "Something went wrong. Check your connection and retry.",
        0,
      );
}

async function readEnvelope(res: Response): Promise<ErrorEnvelope> {
  return (await res.json().catch(() => ({}))) as ErrorEnvelope;
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new TaskApiError(
      "NETWORK_ERROR",
      "Something went wrong. Check your connection and retry.",
      0,
    );
  }
  if (res.ok) return (await res.json()) as T;
  const body = await readEnvelope(res);
  throw new TaskApiError(
    body.error?.code ?? "REQUEST_FAILED",
    body.error?.message ?? "Something went wrong.",
    res.status,
    body.error?.fields,
  );
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export async function listTasks(
  filter: TaskFilter,
  cursor?: string,
): Promise<{ tasks: PublicTask[]; nextCursor: string | null }> {
  const query = new URLSearchParams({ status: filter });
  if (cursor) query.set("cursor", cursor);
  return request(`/api/tasks?${query.toString()}`, { method: "GET" });
}

export async function createTask(values: CreateTaskValues): Promise<PublicTask> {
  const { task } = await request<{ task: PublicTask }>(
    "/api/tasks",
    jsonInit("POST", values),
  );
  return task;
}

export async function updateTask(
  id: string,
  values: UpdateTaskValues & { status?: "active" | "archived" },
): Promise<PublicTask> {
  const { task } = await request<{ task: PublicTask }>(
    `/api/tasks/${id}`,
    jsonInit("PATCH", values),
  );
  return task;
}

/** Archiving hides active work (spec §8.2); completed tasks delete instead. */
export function archiveTask(id: string): Promise<PublicTask> {
  return updateTask(id, { status: "archived" });
}

export function unarchiveTask(id: string): Promise<PublicTask> {
  return updateTask(id, { status: "active" });
}

async function lifecyclePost(
  id: string,
  action: "complete" | "reopen",
): Promise<PublicTask> {
  const { task } = await request<{ task: PublicTask }>(
    `/api/tasks/${id}/${action}`,
    jsonInit("POST"),
  );
  return task;
}

export function completeTask(id: string): Promise<PublicTask> {
  return lifecyclePost(id, "complete");
}

export function reopenTask(id: string): Promise<PublicTask> {
  return lifecyclePost(id, "reopen");
}

export async function deleteTask(id: string): Promise<PublicTask> {
  const { task } = await request<{ task: PublicTask }>(
    `/api/tasks/${id}`,
    jsonInit("DELETE"),
  );
  return task;
}

/** Full-order contract (issue 07): the client sends the complete active set. */
export async function reorderTasks(taskIds: string[]): Promise<PublicTask[]> {
  const { tasks } = await request<{ tasks: PublicTask[] }>(
    "/api/tasks/reorder",
    jsonInit("POST", { taskIds }),
  );
  return tasks;
}
