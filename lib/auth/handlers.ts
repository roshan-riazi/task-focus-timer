import { reportError, toPublicError } from "../errors";
import { ensureRequestId, REQUEST_ID_HEADER } from "../request-id";
import {
  parseSessionCookie,
  serializeClearSessionCookie,
  serializeSessionCookie,
} from "./cookies";
import { isAllowedMutationOrigin } from "./origin";
import { jsonWithRequestId, requireUser } from "./guards";
import type { RateLimitDecision } from "@/lib/rate-limit/limiter";
import type { AppSession } from "./session";
import { AuthServiceError, type AuthService } from "./service";

/**
 * HTTP seam for auth (health-route factory pattern): pure `(Request) =>
 * Response` handlers over injected boundaries. Route files under
 * app/api/auth/* only supply production wiring; every behavior here is
 * covered hermetically (handlers*.test.ts) and against live Postgres
 * (app/api/auth/auth.integration.test.ts + session-scoping.integration.test.ts).
 */
export interface HandlerDeps {
  getService: () => Promise<AuthService>;
  getSession: () => Promise<AppSession | null>;
  /**
   * App origin for the CSRF gate (issue 05). Defaults to `APP_URL` when
   * omitted; tests inject it explicitly to stay hermetic.
   */
  appUrl?: string;
  /**
   * Abuse gate (issue 05, spec §8.1). Bound per route by the route file
   * (bucket + store); omitted on reads and on cookie-authed idempotent
   * logout, which the CSRF gate already protects.
   */
  rateLimit?: (request: Request) => Promise<RateLimitDecision>;
}

function requestIdOf(request: Request): string {
  return ensureRequestId(request.headers.get(REQUEST_ID_HEADER));
}

async function failure(
  error: unknown,
  request: Request,
  requestId: string,
): Promise<Response> {
  if (error instanceof AuthServiceError) {
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
      case "EMAIL_TAKEN":
        return jsonWithRequestId(
          { error: { code: error.code, message: error.message } },
          409,
          requestId,
        );
      case "INVALID_CREDENTIALS":
        return jsonWithRequestId(
          { error: { code: error.code, message: error.message } },
          401,
          requestId,
        );
      case "INVALID_TOKEN":
        return jsonWithRequestId(
          { error: { code: error.code, message: error.message } },
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

/**
 * CSRF gate (issue 05, SYSTEM_DESIGN §3): cookie-authenticated mutations
 * need a proven same-origin Origin/Referer. Returns the 403 rejection, or
 * null when the request may proceed. (Unauthenticated mutations without any
 * origin headers pass — they carry no session to hijack — which also keeps
 * non-browser callers usable; the login path additionally blunts login-CSRF.)
 */
function originRejection(
  request: Request,
  deps: HandlerDeps,
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

/**
 * Abuse gate (issue 05): an exhausted budget rejects with 429 +
 * `Retry-After` before the service runs. No-op when the route binds no
 * rate limit.
 */
async function rateLimitRejection(
  request: Request,
  deps: HandlerDeps,
  requestId: string,
): Promise<Response | null> {
  if (!deps.rateLimit) return null;
  const decision = await deps.rateLimit(request);
  if (decision.allowed) return null;
  return jsonWithRequestId(
    {
      error: {
        code: "RATE_LIMITED",
        message: "Too many attempts. Try again shortly.",
      },
    },
    429,
    requestId,
    { "Retry-After": String(decision.retryAfterSeconds) },
  );
}

/**
 * Mutation wrapper: every POST runs the free CSRF gate first (so
 * cross-origin probes never cost a DB write), then the bound rate limit,
 * then the behavior. GET handlers stay unwrapped — safe methods skip both
 * gates. Future task/timer/settings routes reuse this wrapper.
 */
function withMutationGates(
  deps: HandlerDeps,
  inner: (request: Request, requestId: string) => Promise<Response>,
) {
  return async function gatedMutation(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    const rejected =
      originRejection(request, deps, requestId) ??
      (await rateLimitRejection(request, deps, requestId));
    if (rejected) return rejected;
    try {
      return await inner(request, requestId);
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

export function createRegisterHandler(deps: HandlerDeps) {
  return withMutationGates(deps, async (request, requestId) => {
    const service = await deps.getService();
    const { user, emailed } = await service.register(
      await readJson(request),
    );
    return jsonWithRequestId({ user, emailed }, 201, requestId);
  });
}

export function createLoginHandler(deps: HandlerDeps) {
  return withMutationGates(deps, async (request, requestId) => {
    const service = await deps.getService();
    const { user, sessionToken, expires } = await service.login(
      await readJson(request),
    );
    return jsonWithRequestId({ user }, 200, requestId, {
      "Set-Cookie": serializeSessionCookie(sessionToken, expires),
    });
  });
}

export function createLogoutHandler(deps: HandlerDeps) {
  return withMutationGates(deps, async (request, requestId) => {
    const service = await deps.getService();
    // Idempotent: missing/unknown tokens still clear the cookie and 200.
    await service.logout({
      sessionToken: parseSessionCookie(request.headers.get("cookie")),
    });
    return jsonWithRequestId({}, 200, requestId, {
      "Set-Cookie": serializeClearSessionCookie(),
    });
  });
}

export function createSessionHandler(deps: HandlerDeps) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const session = await deps.getSession();
      return jsonWithRequestId({ user: session?.user ?? null }, 200, requestId);
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

export function createVerifyEmailHandler(deps: HandlerDeps) {
  return withMutationGates(deps, async (request, requestId) => {
    const service = await deps.getService();
    await service.verifyEmail(await readJson(request));
    return jsonWithRequestId({ verified: true }, 200, requestId);
  });
}

export function createResendVerificationHandler(deps: HandlerDeps) {
  return withMutationGates(deps, async (_request, requestId) => {
    // Identity derives from the session, never from client input
    // (spec §11.5): a forged `userId` in the body reaches nothing.
    const auth = await requireUser(deps, requestId);
    if (!auth.ok) return auth.response;
    const service = await deps.getService();
    const { emailed } = await service.requestVerification({
      userId: auth.user.id,
    });
    return jsonWithRequestId({ emailed }, 200, requestId);
  });
}

export function createForgotPasswordHandler(deps: HandlerDeps) {
  return withMutationGates(deps, async (request, requestId) => {
    const service = await deps.getService();
    // Always 200: the service never reveals whether the email exists.
    await service.forgotPassword(await readJson(request));
    return jsonWithRequestId({}, 200, requestId);
  });
}

export function createResetPasswordHandler(deps: HandlerDeps) {
  return withMutationGates(deps, async (request, requestId) => {
    const service = await deps.getService();
    await service.resetPassword(await readJson(request));
    // Reset revokes all sessions: drop the caller's cookie too.
    return jsonWithRequestId({}, 200, requestId, {
      "Set-Cookie": serializeClearSessionCookie(),
    });
  });
}

export function createDeleteAccountHandler(deps: HandlerDeps) {
  return withMutationGates(deps, async (request, requestId) => {
    // Identity derives from the session, never from client input
    // (spec §11.5): the body carries only the DELETE confirmation literal.
    const auth = await requireUser(deps, requestId);
    if (!auth.ok) return auth.response;
    const service = await deps.getService();
    const result = await service.deleteAccount(
      auth.user.id,
      await readJson(request),
    );
    // The purge revokes every session including the caller's: clear its cookie.
    return jsonWithRequestId(result, 200, requestId, {
      "Set-Cookie": serializeClearSessionCookie(),
    });
  });
}
