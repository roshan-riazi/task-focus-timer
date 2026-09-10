import { reportError, toPublicError } from "../errors";
import { ensureRequestId, REQUEST_ID_HEADER } from "../request-id";
import { isAllowedMutationOrigin } from "../auth/origin";
import { jsonWithRequestId, notFound, requireUser } from "../auth/guards";
import type { AppSession } from "../auth/session";
import { TaskServiceError, type TaskService } from "./service";

/**
 * HTTP seam for tasks (health-route factory pattern, mirroring
 * `lib/auth/handlers`): pure `(Request) => Response` handlers over injected
 * boundaries. Route files under app/api/tasks/* only supply production
 * wiring; behavior is covered hermetically (handlers.test.ts) and against
 * live Postgres (app/api/tasks/tasks.integration.test.ts).
 */
export interface TaskHandlerDeps {
  getService: () => Promise<TaskService>;
  getSession: () => Promise<AppSession | null>;
  /**
   * App origin for the CSRF gate. Defaults to `APP_URL` when omitted;
   * tests inject it explicitly to stay hermetic.
   */
  appUrl?: string;
}

export interface TaskRouteContext {
  params: Promise<{ id: string }>;
}

function requestIdOf(request: Request): string {
  return ensureRequestId(request.headers.get(REQUEST_ID_HEADER));
}

async function failure(
  error: unknown,
  request: Request,
  requestId: string,
): Promise<Response> {
  if (error instanceof TaskServiceError) {
    switch (error.code) {
      case "VALIDATION_ERROR":
        return jsonWithRequestId(
          {
            error: {
              code: error.code,
              message: error.message,
              fields: error.fields ?? {},
            },
          },
          400,
          requestId,
        );
      case "NOT_FOUND":
        // Leak-free: foreign, missing, and soft-deleted ids share one shape
        // (spec §12.2; `notFound` is the shared envelope from guards).
        return notFound(requestId);
      case "TASK_LOCKED_BY_TIMER":
        return jsonWithRequestId(
          { error: { code: error.code, message: error.message } },
          409,
          requestId,
        );
    }
  }
  await reportError(error, { requestId });
  const pub = toPublicError(error);
  return jsonWithRequestId(pub.body, pub.status, requestId);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    // Empty/unparsable bodies fail validation (400), never the parser.
    return null;
  }
}

/**
 * CSRF gate (SYSTEM_DESIGN §3, same contract as the auth seam):
 * cookie-authenticated mutations need a proven same-origin Origin/Referer.
 * GET handlers stay unwrapped — safe methods skip the gate.
 */
function originRejection(
  request: Request,
  deps: TaskHandlerDeps,
  requestId: string,
): Response | null {
  if (isAllowedMutationOrigin(request, deps.appUrl)) return null;
  return jsonWithRequestId(
    {
      error: {
        code: "ORIGIN_MISMATCH",
        message: "Cross-origin request blocked.",
      },
    },
    403,
    requestId,
  );
}

type AuthedHandler = (
  request: Request,
  requestId: string,
  userId: string,
  service: TaskService,
) => Promise<Response>;

/** Read path: session gate, then behavior. */
function withAuth(deps: TaskHandlerDeps, inner: AuthedHandler) {
  return async function handler(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const auth = await requireUser(deps, requestId);
      if (!auth.ok) return auth.response;
      return await inner(request, requestId, auth.user.id, await deps.getService());
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

/** Mutation path: CSRF gate first (free), then the session gate + behavior. */
function withMutationAuth(deps: TaskHandlerDeps, inner: AuthedHandler) {
  return async function handler(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    const rejected = originRejection(request, deps, requestId);
    if (rejected) return rejected;
    try {
      const auth = await requireUser(deps, requestId);
      if (!auth.ok) return auth.response;
      return await inner(request, requestId, auth.user.id, await deps.getService());
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

type IdHandler = (
  request: Request,
  context: TaskRouteContext,
) => Promise<Response>;

/** `:id` routes: same gates, plus the `await params` unwrap (Next 15+ async params). */
function withIdAuth(
  deps: TaskHandlerDeps,
  inner: (
    request: Request,
    requestId: string,
    userId: string,
    service: TaskService,
    id: string,
  ) => Promise<Response>,
  mutate: boolean,
): IdHandler {
  const run = async (
    request: Request,
    context: TaskRouteContext,
  ): Promise<Response> => {
    const requestId = requestIdOf(request);
    if (mutate) {
      const rejected = originRejection(request, deps, requestId);
      if (rejected) return rejected;
    }
    try {
      const auth = await requireUser(deps, requestId);
      if (!auth.ok) return auth.response;
      const { id } = await context.params;
      return await inner(
        request,
        requestId,
        auth.user.id,
        await deps.getService(),
        id,
      );
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
  return run;
}

export function createListTasksHandler(deps: TaskHandlerDeps) {
  return withAuth(deps, async (request, requestId, userId, service) => {
    // Raw searchParam strings reach the service untouched — `limit`
    // coercion and defaults live in the Zod boundary (validation.ts).
    const query = new URL(request.url).searchParams;
    const { tasks, nextCursor } = await service.list(userId, {
      status: query.get("status") ?? undefined,
      limit: query.get("limit") ?? undefined,
      cursor: query.get("cursor") ?? undefined,
    });
    return jsonWithRequestId({ tasks, nextCursor }, 200, requestId);
  });
}

export function createCreateTaskHandler(deps: TaskHandlerDeps) {
  return withMutationAuth(deps, async (request, requestId, userId, service) => {
    // Identity derives from the session, never from client input
    // (spec §11.5): a forged `userId` in the body reaches nothing.
    const task = await service.create(userId, await readJson(request));
    return jsonWithRequestId({ task }, 201, requestId);
  });
}

export function createGetTaskHandler(deps: TaskHandlerDeps) {
  return withIdAuth(
    deps,
    async (_request, requestId, userId, service, id) => {
      const task = await service.get(userId, id);
      return jsonWithRequestId({ task }, 200, requestId);
    },
    false,
  );
}

export function createPatchTaskHandler(deps: TaskHandlerDeps) {
  return withIdAuth(
    deps,
    async (request, requestId, userId, service, id) => {
      const task = await service.update(userId, id, await readJson(request));
      return jsonWithRequestId({ task }, 200, requestId);
    },
    true,
  );
}

export function createCompleteTaskHandler(deps: TaskHandlerDeps) {
  return withIdAuth(
    deps,
    async (_request, requestId, userId, service, id) => {
      const task = await service.complete(userId, id);
      return jsonWithRequestId({ task }, 200, requestId);
    },
    true,
  );
}

export function createReopenTaskHandler(deps: TaskHandlerDeps) {
  return withIdAuth(
    deps,
    async (_request, requestId, userId, service, id) => {
      const task = await service.reopen(userId, id);
      return jsonWithRequestId({ task }, 200, requestId);
    },
    true,
  );
}

export function createDeleteTaskHandler(deps: TaskHandlerDeps) {
  return withIdAuth(
    deps,
    async (_request, requestId, userId, service, id) => {
      const task = await service.remove(userId, id);
      return jsonWithRequestId({ task }, 200, requestId);
    },
    true,
  );
}

export function createReorderTasksHandler(deps: TaskHandlerDeps) {
  return withMutationAuth(deps, async (request, requestId, userId, service) => {
    const tasks = await service.reorder(userId, await readJson(request));
    return jsonWithRequestId({ tasks }, 200, requestId);
  });
}
