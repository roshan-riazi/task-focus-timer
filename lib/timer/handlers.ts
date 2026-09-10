import { reportError, toPublicError } from "../errors";
import { ensureRequestId, REQUEST_ID_HEADER } from "../request-id";
import { isAllowedMutationOrigin } from "../auth/origin";
import { jsonWithRequestId, notFound, requireUser } from "../auth/guards";
import type { AppSession } from "../auth/session";
import { TimerServiceError, type TimerService } from "./service";

/**
 * HTTP seam for the timer (health-route factory pattern, mirroring
 * `lib/tasks/handlers`): pure `(Request) => Response` handlers over
 * injected boundaries. Route files under app/api/timer/* only supply
 * production wiring; behavior is covered hermetically (handlers.test.ts)
 * and against live Postgres (app/api/timer/timer.integration.test.ts).
 */
export interface TimerHandlerDeps {
  getService: () => Promise<TimerService>;
  getSession: () => Promise<AppSession | null>;
  /**
   * App origin for the CSRF gate. Defaults to `APP_URL` when omitted;
   * tests inject it explicitly to stay hermetic.
   */
  appUrl?: string;
}

function requestIdOf(request: Request): string {
  return ensureRequestId(request.headers.get(REQUEST_ID_HEADER));
}

async function failure(
  error: unknown,
  request: Request,
  requestId: string,
): Promise<Response> {
  if (error instanceof TimerServiceError) {
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
        // Leak-free: foreign, missing, and soft-deleted task ids share one
        // shape (spec §12.2; `notFound` is the shared envelope from guards).
        return notFound(requestId);
      case "ACTIVE_TIMER_EXISTS":
      case "NO_ACTIVE_TIMER":
      case "ALREADY_FINALIZED":
      case "INVALID_TRANSITION":
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

type AuthedHandler = (
  request: Request,
  requestId: string,
  userId: string,
  service: TimerService,
) => Promise<Response>;

/** Read path: session gate, then behavior. */
function withAuth(deps: TimerHandlerDeps, inner: AuthedHandler) {
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
function withMutationAuth(deps: TimerHandlerDeps, inner: AuthedHandler) {
  return async function handler(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    if (!isAllowedMutationOrigin(request, deps.appUrl)) {
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
    try {
      const auth = await requireUser(deps, requestId);
      if (!auth.ok) return auth.response;
      return await inner(request, requestId, auth.user.id, await deps.getService());
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

/**
 * `Idempotency-Key` header for finalize operations (SYSTEM_DESIGN §6, spec
 * §11.5): opaque client key, validated in the service (malformed → 400).
 * `Headers.get` is case-insensitive; absent reads as null (no replay, a
 * repeat finalize conflicts as ALREADY_FINALIZED instead).
 */
function idempotencyKeyOf(request: Request): string | null {
  return request.headers.get("idempotency-key");
}

export function createCurrentTimerHandler(deps: TimerHandlerDeps) {
  return withAuth(deps, async (_request, requestId, userId, service) => {
    // The reconcile entry point (spec §8.4): a GET that may lazily
    // auto-finalize an interval expired within the grace window — the same
    // write-on-read precedent as the settings-GET defaults bootstrap
    // (issue 09). Worst-case cross-site trigger only accelerates the
    // specified auto-complete (no data leak; the response is unreadable
    // cross-origin and SameSite cookies bound the vector).
    const result = await service.current(userId);
    return jsonWithRequestId(result, 200, requestId);
  });
}

export function createStartTimerHandler(deps: TimerHandlerDeps) {
  return withMutationAuth(deps, async (request, requestId, userId, service) => {
    // Identity derives from the session, never from client input
    // (spec §11.5): forged keys in the body strip at the Zod boundary.
    const session = await service.start(userId, await readJson(request));
    return jsonWithRequestId({ session }, 201, requestId);
  });
}

export function createPauseTimerHandler(deps: TimerHandlerDeps) {
  return withMutationAuth(deps, async (_request, requestId, userId, service) => {
    const session = await service.pause(userId);
    return jsonWithRequestId({ session }, 200, requestId);
  });
}

export function createResumeTimerHandler(deps: TimerHandlerDeps) {
  return withMutationAuth(deps, async (_request, requestId, userId, service) => {
    const session = await service.resume(userId);
    return jsonWithRequestId({ session }, 200, requestId);
  });
}

export function createCompleteTimerHandler(deps: TimerHandlerDeps) {
  return withMutationAuth(deps, async (request, requestId, userId, service) => {
    const result = await service.complete(userId, {
      idempotencyKey: idempotencyKeyOf(request),
    });
    return jsonWithRequestId(result, 200, requestId);
  });
}

export function createCancelTimerHandler(deps: TimerHandlerDeps) {
  return withMutationAuth(deps, async (request, requestId, userId, service) => {
    const result = await service.cancel(userId, {
      idempotencyKey: idempotencyKeyOf(request),
    });
    return jsonWithRequestId(result, 200, requestId);
  });
}

export function createSkipBreakTimerHandler(deps: TimerHandlerDeps) {
  return withMutationAuth(deps, async (request, requestId, userId, service) => {
    const result = await service.skipBreak(userId, {
      idempotencyKey: idempotencyKeyOf(request),
    });
    return jsonWithRequestId(result, 200, requestId);
  });
}
