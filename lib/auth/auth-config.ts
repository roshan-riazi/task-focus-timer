import type { AuthConfig } from "@auth/core";
import { SESSION_MAX_AGE_SECONDS } from "./service";
import { sessionCookieConfig } from "./cookies";

/**
 * Shared Auth.js options (ADR-0002: Auth.js v5, database sessions).
 *
 * Both the Next.js `auth()` reader (lib/auth/session.ts) and the @auth/core
 * compatibility test build from here, so writer and reader cannot drift.
 *
 * Deliberate deviation, documented: no Credentials provider is configured.
 * @auth/core hardcodes JWT issuance for its credentials callback (it never
 * touches the adapter session store), which would silently break the
 * single-DB purge story. Credential verification, registration, email
 * verification, and password reset are app-managed in lib/auth/service.ts;
 * Auth.js owns session STORAGE (adapter tables) and READS (`auth()`), with
 * login/logout setting the Auth.js-shaped cookie from cookies.ts.
 */
export function createAuthConfig(
  adapter: NonNullable<AuthConfig["adapter"]>,
): AuthConfig {
  return {
    adapter,
    providers: [],
    session: {
      strategy: "database",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
    useSecureCookies: sessionCookieConfig().secure,
    // Required outside `localhost` (127.0.0.1, Docker/VPS hostnames,
    // proxies): without it Auth.js rejects session reads with
    // UntrustedHost. Safe here — the app builds no Auth.js redirects
    // (no OAuth; credentials + session reads only), so there is no
    // redirect-host to poison.
    trustHost: true,
    callbacks: {
      // Expose the app session shape: stable id for per-user scoping
      // (later issues), emailVerified for the verification nag, timezone
      // for reporting boundaries. Secrets (passwordHash) never leave —
      // only these fields are selected from the adapter user row.
      session({ session, user }) {
        return {
          ...session,
          user: {
            ...session.user,
            id: user.id,
            email: user.email ?? "",
            emailVerified: user.emailVerified?.toISOString() ?? null,
            timezone:
              (user as Partial<{ timezone: string }>).timezone ?? "UTC",
          },
        };
      },
    },
  };
}
