import { REQUEST_ID_HEADER } from "../request-id";
import type { AppSession, AppSessionUser } from "./session";

export type RequireUserResult =
  | { ok: true; user: AppSessionUser }
  | { ok: false; response: Response };

/**
 * JSON envelope with the request ID attached (shared by the auth HTTP seam
 * so success, guard-rejection, and error shapes correlate under one ID).
 */
export function jsonWithRequestId(
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

/**
 * Per-request scoping entry point (issue 05, spec §8.1/§11.5): identity
 * always derives from the authenticated session, never from client input
 * (no endpoint accepts an arbitrary user ID). Every guarded route enters
 * here and returns `response` directly when `ok` is false.
 */
export async function requireUser(
  deps: { getSession: () => Promise<AppSession | null> },
  requestId: string,
): Promise<RequireUserResult> {
  const session = await deps.getSession();
  if (!session) {
    return {
      ok: false,
      response: jsonWithRequestId(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Sign in to continue.",
          },
        },
        401,
        requestId,
      ),
    };
  }
  return { ok: true, user: session.user };
}

/**
 * Leak-free denial (spec §12.2, ticket acceptance "forbidden or not-found"):
 * cross-user record access answers exactly like a genuinely missing id, so
 * error responses never reveal whether another user's resource exists.
 * First callers land with the task/timer/settings routes (issues 07+); the
 * envelope is pinned here now so those routes share one shape.
 */
export function notFound(requestId: string): Response {
  return jsonWithRequestId(
    { error: { code: "NOT_FOUND", message: "Not found." } },
    404,
    requestId,
  );
}
