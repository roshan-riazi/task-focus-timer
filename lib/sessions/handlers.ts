import { reportError, toPublicError } from "../errors";
import { ensureRequestId, REQUEST_ID_HEADER } from "../request-id";
import { jsonWithRequestId, requireUser } from "../auth/guards";
import type { AppSession } from "../auth/session";
import { HistoryServiceError, type HistoryService } from "./service";

/**
 * HTTP seam for history (health-route factory pattern, mirroring
 * `lib/tasks/handlers`): pure `(Request) => Response` handlers over
 * injected boundaries. Route files under app/api/sessions/* only supply
 * production wiring; behavior is covered hermetically (handlers.test.ts)
 * and against live Postgres
 * (app/api/sessions/sessions.integration.test.ts).
 *
 * Read-only: GET handlers stay outside the CSRF gate (safe methods skip
 * it, same contract as the task/timer read paths).
 */
export interface HistoryHandlerDeps {
  getService: () => Promise<HistoryService>;
  getSession: () => Promise<AppSession | null>;
}

function requestIdOf(request: Request): string {
  return ensureRequestId(request.headers.get(REQUEST_ID_HEADER));
}

async function failure(
  error: unknown,
  request: Request,
  requestId: string,
): Promise<Response> {
  if (error instanceof HistoryServiceError) {
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
    }
  }
  await reportError(error, { requestId });
  const pub = toPublicError(error);
  return jsonWithRequestId(pub.body, pub.status, requestId);
}

export function createListSessionsHandler(deps: HistoryHandlerDeps) {
  return async function handler(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const auth = await requireUser(deps, requestId);
      if (!auth.ok) return auth.response;
      const service = await deps.getService();
      // Raw searchParam strings reach the service untouched — `limit`
      // coercion and defaults live in the Zod boundary (validation.ts).
      const query = new URL(request.url).searchParams;
      const { sessions, nextCursor } = await service.list(auth.user.id, {
        period: query.get("period") ?? undefined,
        type: query.get("type") ?? undefined,
        limit: query.get("limit") ?? undefined,
        cursor: query.get("cursor") ?? undefined,
      });
      return jsonWithRequestId({ sessions, nextCursor }, 200, requestId);
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}
