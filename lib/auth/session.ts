import type { Session } from "next-auth";

export interface AppSessionUser {
  id: string;
  email: string;
  /** ISO timestamp, or null while the verification nag applies. */
  emailVerified: string | null;
  timezone: string;
}

export interface AppSession {
  user: AppSessionUser;
  expires: string;
}

type AuthInstance = {
  auth: () => Promise<Session | null>;
};

let cached: AuthInstance | null = null;

/**
 * Lazily built NextAuth instance (module import stays hermetic — no DB or
 * env access until the first session read, per the health-route pattern).
 */
async function getAuth(): Promise<AuthInstance> {
  if (!cached) {
    const { default: NextAuth } = await import("next-auth");
    const { PrismaAdapter } = await import("@auth/prisma-adapter");
    const { db } = await import("@/lib/db");
    const { createAuthConfig } = await import("./auth-config");
    cached = NextAuth(createAuthConfig(PrismaAdapter(db)));
  }
  return cached;
}

/**
 * Read the current database session via Auth.js. Returns null when signed
 * out, expired, or malformed — never throws for missing sessions. Fail-closed
 * field mapping: a session row without id/email yields null (never a
 * half-identified user for downstream scoping).
 */
export async function getSession(): Promise<AppSession | null> {
  const { auth } = await getAuth();
  const session = await auth();
  if (!session) return null;
  const user = session.user as Partial<AppSessionUser> | undefined;
  if (!user?.id || !user.email) return null;
  return {
    user: {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified ?? null,
      timezone: user.timezone ?? "UTC",
    },
    expires: session.expires,
  };
}
