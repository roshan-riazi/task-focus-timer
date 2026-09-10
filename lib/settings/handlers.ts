import { reportError, toPublicError } from "../errors";
import { ensureRequestId, REQUEST_ID_HEADER } from "../request-id";
import { isAllowedMutationOrigin } from "../auth/origin";
import { jsonWithRequestId, requireUser } from "../auth/guards";
import type { AppSession } from "../auth/session";
import { SettingsServiceError, type SettingsService } from "./service";

/**
 * HTTP seam for settings (health-route factory pattern, mirroring
 * `lib/tasks/handlers`): pure `(Request) => Response` handlers over
 * injected boundaries. Route files under app/api/settings/* only supply
 * production wiring; behavior is covered hermetically (handlers.test.ts)
 * and against live Postgres
 * (app/api/settings/settings.integration.test.ts).
 */
export interface SettingsHandlerDeps {
  getService: () => Promise<SettingsService>;
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
  if (error instanceof SettingsServiceError) {
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
  service: SettingsService,
) => Promise<Response>;

/** Read path: session gate, then behavior. */
function withAuth(deps: SettingsHandlerDeps, inner: AuthedHandler) {
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
function withMutationAuth(deps: SettingsHandlerDeps, inner: AuthedHandler) {
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

export function createGetSettingsHandler(deps: SettingsHandlerDeps) {
  return withAuth(deps, async (_request, requestId, userId, service) => {
    const settings = await service.get(userId);
    return jsonWithRequestId({ settings }, 200, requestId);
  });
}

export function createUpdateSettingsHandler(deps: SettingsHandlerDeps) {
  return withMutationAuth(deps, async (request, requestId, userId, service) => {
    // Identity derives from the session, never from client input
    // (spec §11.5): a forged `userId` in the body reaches nothing.
    const settings = await service.update(userId, await readJson(request));
    return jsonWithRequestId({ settings }, 200, requestId);
  });
}
