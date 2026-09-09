import { reportError, toPublicError } from "../errors";
import { ensureRequestId, REQUEST_ID_HEADER } from "../request-id";
import {
  parseSessionCookie,
  serializeClearSessionCookie,
  serializeSessionCookie,
} from "./cookies";
import type { AppSession } from "./session";
import { AuthServiceError, type AuthService } from "./service";

/**
 * HTTP seam for auth (health-route factory pattern): pure `(Request) =>
 * Response` handlers over injected boundaries. Route files under
 * app/api/auth/* only supply production wiring; every behavior here is
 * covered hermetically in handlers.test.ts and against live Postgres in
 * app/api/auth/auth.integration.test.ts.
 */
export interface HandlerDeps {
  getService: () => Promise<AuthService>;
  getSession: () => Promise<AppSession | null>;
}

function requestIdOf(request: Request): string {
  return ensureRequestId(request.headers.get(REQUEST_ID_HEADER));
}

function json(
  payload: unknown,
  status: number,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(payload, {
    status,
    headers: { [REQUEST_ID_HEADER]: requestId, ...extraHeaders },
  });
}

async function failure(
  error: unknown,
  request: Request,
  requestId: string,
): Promise<Response> {
  if (error instanceof AuthServiceError) {
    switch (error.code) {
      case "VALIDATION_ERROR":
        return json(
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
        return json(
          { error: { code: error.code, message: error.message } },
          409,
          requestId,
        );
      case "INVALID_CREDENTIALS":
        return json(
          { error: { code: error.code, message: error.message } },
          401,
          requestId,
        );
      case "INVALID_TOKEN":
        return json(
          { error: { code: error.code, message: error.message } },
          400,
          requestId,
        );
    }
  }
  await reportError(error, { requestId });
  const pub = toPublicError(error);
  return json(pub.body, pub.status, requestId);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    // Empty/unparsable bodies fail validation (400), never the parser.
    return null;
  }
}

export function createRegisterHandler(deps: HandlerDeps) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const service = await deps.getService();
      const { user, emailed } = await service.register(
        await readJson(request),
      );
      return json({ user, emailed }, 201, requestId);
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

export function createLoginHandler(deps: HandlerDeps) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const service = await deps.getService();
      const { user, sessionToken, expires } = await service.login(
        await readJson(request),
      );
      return json({ user }, 200, requestId, {
        "Set-Cookie": serializeSessionCookie(sessionToken, expires),
      });
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

export function createLogoutHandler(deps: HandlerDeps) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const service = await deps.getService();
      // Idempotent: missing/unknown tokens still clear the cookie and 200.
      await service.logout({
        sessionToken: parseSessionCookie(request.headers.get("cookie")),
      });
      return json({}, 200, requestId, {
        "Set-Cookie": serializeClearSessionCookie(),
      });
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

export function createSessionHandler(deps: HandlerDeps) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const session = await deps.getSession();
      return json({ user: session?.user ?? null }, 200, requestId);
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

export function createVerifyEmailHandler(deps: HandlerDeps) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const service = await deps.getService();
      await service.verifyEmail(await readJson(request));
      return json({ verified: true }, 200, requestId);
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

export function createResendVerificationHandler(deps: HandlerDeps) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const session = await deps.getSession();
      if (!session) {
        return json(
          {
            error: {
              code: "UNAUTHENTICATED",
              message: "Sign in to resend the verification email.",
            },
          },
          401,
          requestId,
        );
      }
      const service = await deps.getService();
      const { emailed } = await service.requestVerification({
        userId: session.user.id,
      });
      return json({ emailed }, 200, requestId);
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

export function createForgotPasswordHandler(deps: HandlerDeps) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const service = await deps.getService();
      // Always 200: the service never reveals whether the email exists.
      await service.forgotPassword(await readJson(request));
      return json({}, 200, requestId);
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}

export function createResetPasswordHandler(deps: HandlerDeps) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = requestIdOf(request);
    try {
      const service = await deps.getService();
      await service.resetPassword(await readJson(request));
      // Reset revokes all sessions: drop the caller's cookie too.
      return json({}, 200, requestId, {
        "Set-Cookie": serializeClearSessionCookie(),
      });
    } catch (error) {
      return failure(error, request, requestId);
    }
  };
}
