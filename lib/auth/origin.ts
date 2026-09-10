import { parseSessionCookie } from "./cookies";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function parseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function appOriginOf(appUrl: string | undefined): string | null {
  try {
    return new URL(appUrl ?? process.env.APP_URL ?? "http://localhost:3000")
      .origin;
  } catch {
    return null;
  }
}

/**
 * CSRF gate for cookie-authenticated mutations (issue 05, SYSTEM_DESIGN §3).
 *
 * Pure function of the request + app URL (no Next.js imports) so route
 * handlers stay thin and tests stay hermetic:
 *
 * - Safe methods (GET/HEAD/OPTIONS) always pass — nothing mutates.
 * - When `Origin` is present it decides alone (exact origin compare;
 *   malformed values fail closed).
 * - Otherwise `Referer` decides, when present.
 * - With neither header, only requests WITHOUT our session cookie pass:
 *   non-browser callers (curl, tests, health probes) stay usable while any
 *   cookie-bearing request without proven provenance fails closed — a
 *   cross-site form post can never omit the Origin header.
 */
export function isAllowedMutationOrigin(
  request: Request,
  appUrl?: string,
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const appOrigin = appOriginOf(appUrl);
  if (appOrigin === null) return false;

  const originHeader = request.headers.get("origin");
  if (originHeader !== null) {
    return parseOrigin(originHeader) === appOrigin;
  }
  const refererHeader = request.headers.get("referer");
  if (refererHeader !== null) {
    return parseOrigin(refererHeader) === appOrigin;
  }
  return parseSessionCookie(request.headers.get("cookie")) === undefined;
}
