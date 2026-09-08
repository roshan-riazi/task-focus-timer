import { reportError } from "./errors";
import { createLogger } from "./log";
import { ensureRequestId, REQUEST_ID_HEADER } from "./request-id";

export type DbCheck = () => Promise<unknown>;

export interface HealthBody {
  status: "ok" | "error";
  checks: { db: "up" | "down" };
}

function healthResponse(
  body: HealthBody,
  status: number,
  requestId: string,
): Response {
  return Response.json(body, {
    status,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

/**
 * Health handler factory — the public seam for this route.
 *
 * The database is a system boundary: callers inject the liveness probe
 * (production passes the Prisma `SELECT 1` probe from `./route`; tests pass
 * fakes). This module never imports the DB client, so health assertions stay
 * hermetic even when the database is unreachable.
 */
export function createGetHealth(checkDb: DbCheck) {
  return async function GET(request?: Request): Promise<Response> {
    const requestId = ensureRequestId(
      request?.headers.get(REQUEST_ID_HEADER) ?? null,
    );
    const log = createLogger({ requestId });
    try {
      await checkDb();
      log.info({ route: "/api/health", db: "up" }, "health check");
      return healthResponse(
        { status: "ok", checks: { db: "up" } },
        200,
        requestId,
      );
    } catch (cause) {
      // Never leak driver internals: stable envelope only; details go to
      // the scrubbed error pipeline with the request ID for correlation.
      await reportError(cause, { requestId });
      log.warn({ route: "/api/health", db: "down" }, "health check failed");
      return healthResponse(
        { status: "error", checks: { db: "down" } },
        503,
        requestId,
      );
    }
  };
}
