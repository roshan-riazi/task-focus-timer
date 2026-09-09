/**
 * Auth.js session-cookie contract, centralized.
 *
 * Auth.js v5 database sessions persist the raw `sessionToken` in an
 * HTTP-only SameSite=Lax cookie named `authjs.session-token`, or
 * `__Secure-authjs.session-token` with the Secure flag when the site URL is
 * HTTPS (`defaultCookies(useSecureCookies)` in @auth/core). Our custom
 * credential endpoints (login/logout) set and clear that same cookie so the
 * Auth.js `auth()` reader — configured with the same `useSecureCookies`
 * value in auth-config.ts — accepts the sessions we issue. Covered by the
 * @auth/core round-trip test (auth-compat.test.ts) and the cases below.
 */

const BASE_NAME = "authjs.session-token";
const LOCAL_DEFAULT_URL = "http://localhost:3000";

export interface SessionCookieConfig {
  name: string;
  secure: boolean;
}

/**
 * Single source of truth for secure-cookie mode: HTTPS APP_URL means
 * production-grade cookies; anything else (localhost, E2E over http,
 * malformed values) means plain. Never throws.
 */
export function sessionCookieConfig(): SessionCookieConfig {
  let secure = false;
  try {
    secure =
      new URL(process.env.APP_URL ?? LOCAL_DEFAULT_URL).protocol === "https:";
  } catch {
    secure = false;
  }
  return { name: secure ? `__Secure-${BASE_NAME}` : BASE_NAME, secure };
}

export function sessionCookieName(): string {
  return sessionCookieConfig().name;
}

export function sessionCookieAttributes(expires: Date): {
  httpOnly: boolean;
  sameSite: "lax";
  path: string;
  secure: boolean;
  expires: Date;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: sessionCookieConfig().secure,
    expires,
  };
}

/**
 * `Set-Cookie` value for a fresh session. Pure string building (no
 * next/headers) so route handlers stay thin and tests stay hermetic: the
 * value is appended to the returned Response; clearing uses Max-Age=0.
 */
export function serializeSessionCookie(
  sessionToken: string,
  expires: Date,
): string {
  const { name, secure } = sessionCookieConfig();
  const parts = [
    `${name}=${sessionToken}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires.toUTCString()}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function serializeClearSessionCookie(): string {
  const { name, secure } = sessionCookieConfig();
  const parts = [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Read the session token from an incoming Cookie header (or null). */
export function parseSessionCookie(
  header: string | null,
): string | undefined {
  if (!header) return undefined;
  const { name } = sessionCookieConfig();
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}
