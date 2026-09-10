import { reportError, toPublicError } from "../errors";
import { ensureRequestId, REQUEST_ID_HEADER } from "../request-id";
import { jsonWithRequestId, requireUser } from "../auth/guards";
import type { AppSession } from "../auth/session";
import { AnalyticsServiceError, type AnalyticsService } from "./service";

/**
 * HTTP seam for analytics (health-route factory pattern, mirroring
 * `lib/sessions/handlers`): pure `(Request) => Response` handlers over
 * injected boundaries. Route files under app/api/analytics/* only supply
 * production wiring; behavior is covered hermetically (handlers.test.ts)
 * and against live Postgres
 * (app/api/analytics/summary/analytics.integration.test.ts).
 *
 * Read-only: GET handlers stay outside the CSRF gate (safe methods skip
 * it, same contract as the task/timer/history read paths).
 */
export interface AnalyticsHandlerDeps {
  getService: () => Promise<AnalyticsService>;
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
  if (error instanceof AnalyticsServiceError) {
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

export function createAnalyticsSummaryHandler(deps: AnalyticsHandlerDeps) {
  return async function handler(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const auth = await requireUser(deps, requestId);
      if (!auth.ok) return auth.response;
      const service = await deps.getService();
      // Raw searchParam strings reach the service untouched — defaults
      // live in the Zod boundary (validation.ts).
      const query = new URL(request.url).searchParams;
      const period = query.get("period") ?? undefined;
      const summary = await service.summary(auth.user.id, {
        ...(period !== undefined ? { period } : {}),
      });
      return jsonWithRequestId(summary, 200, requestId);
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}
