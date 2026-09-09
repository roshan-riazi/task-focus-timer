import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Auth } from "@auth/core";
import type { Adapter, AdapterSession, AdapterUser } from "@auth/core/adapters";
import { createAuthConfig } from "./auth-config";
import { SESSION_MAX_AGE_SECONDS } from "./service";
import { sessionCookieName } from "./cookies";

/**
 * Writer/reader interop proof (issue 04): sessions created the way the login
 * endpoint creates them (adapter `createSession` + Auth.js-shaped cookie from
 * cookies.ts) must be readable by genuine Auth.js session code. Runs the real
 * @auth/core `Auth` handler for `/api/auth/session` against an in-memory
 * adapter — no Postgres needed, no Auth.js internals mocked.
 */
function createMemoryAdapter(): Adapter & {
  sessions: Map<string, AdapterSession>;
  users: Map<string, AdapterUser>;
} {
  const sessions = new Map<string, AdapterSession>();
  const users = new Map<string, AdapterUser>();
  return {
    sessions,
    users,
    async createUser(data) {
      const user: AdapterUser = {
        id: `user-${users.size + 1}`,
        email: data.email ?? "",
        emailVerified: null,
      };
      users.set(user.id, user);
      return user;
    },
    async getUser(id) {
      return users.get(id) ?? null;
    },
    async getUserByEmail(email) {
      for (const user of users.values()) {
        if (user.email === email) return user;
      }
      return null;
    },
    async createSession(data) {
      const session: AdapterSession = {
        sessionToken: data.sessionToken,
        userId: data.userId,
        expires: data.expires,
      };
      sessions.set(session.sessionToken, session);
      return session;
    },
    async getSessionAndUser(sessionToken) {
      const session = sessions.get(sessionToken);
      if (!session) return null;
      const user = users.get(session.userId);
      if (!user) return null;
      return { session, user };
    },
    async updateSession(data) {
      const session = sessions.get(data.sessionToken);
      if (!session) return null;
      const updated = { ...session, ...data };
      sessions.set(updated.sessionToken, updated);
      return updated;
    },
    async deleteSession(sessionToken) {
      sessions.delete(sessionToken);
    },
    // Required by Auth.js adapter validation; unused by session reads.
    async getUserByAccount() {
      return null;
    },
    async updateUser(data) {
      const existing = users.get(data.id as string);
      if (!existing) throw new Error("no such user");
      const updated = { ...existing, ...data };
      users.set(updated.id, updated);
      return updated;
    },
    async linkAccount() {
      return undefined;
    },
  };
}

// Random per file-load: assertions only need one consistent value within
// the run, and no literal means no secret-scanner finding (the value is
// test-only Auth.js HMAC keying, never a real credential).
const TEST_SECRET = `${randomUUID()}-${randomUUID()}-test-only`;

async function readSession(
  adapter: Adapter,
  cookieHeader: string,
): Promise<{ status: number; body: unknown }> {
  const response = await Auth(
    new Request("http://localhost:3000/api/auth/session", {
      headers: { cookie: cookieHeader },
    }),
    {
      ...createAuthConfig(adapter),
      // The Next.js framework default; @auth/core alone defaults to /auth.
      basePath: "/api/auth",
      secret: TEST_SECRET,
      trustHost: true,
    },
  );
  return { status: response.status, body: await response.json() };
}

describe("Auth.js session interop (login-written sessions are auth()-readable)", () => {
  it("reads a service-issued session through real Auth.js code", async () => {
    const adapter = createMemoryAdapter();
    const verifiedAt = new Date("2026-09-07T10:00:00.000Z");
    const user = await adapter.createUser!({
      email: "alice@example.com",
      emailVerified: null,
    } as AdapterUser);
    adapter.users.set(user.id, {
      ...user,
      emailVerified: verifiedAt,
      timezone: "Europe/Berlin",
    } as never);
    // Exactly what POST /api/auth/login persists (service + prisma store).
    const sessionToken = "11111111-2222-4333-8444-555555555555";
    await adapter.createSession!({
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    });

    const { status, body } = await readSession(
      adapter,
      `${sessionCookieName()}=${sessionToken}`,
    );
    expect(status).toBe(200);
    // App session shape: stable id, verification state for the nag,
    // timezone for reporting — and nothing else (no passwordHash).
    expect(body).toMatchObject({
      user: {
        id: user.id,
        email: "alice@example.com",
        emailVerified: verifiedAt.toISOString(),
        timezone: "Europe/Berlin",
      },
    });
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  it("returns no user for unknown session tokens", async () => {
    const adapter = createMemoryAdapter();
    const { status, body } = await readSession(
      adapter,
      `${sessionCookieName()}=no-such-token`,
    );
    expect(status).toBe(200);
    expect(body).toBeNull();
  });

  it("expires stale sessions (and cleans them up)", async () => {
    const adapter = createMemoryAdapter();
    const user = await adapter.createUser!({
      email: "bob@example.com",
      emailVerified: null,
    } as AdapterUser);
    const sessionToken = "stale-session-token";
    await adapter.createSession!({
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() - 1000),
    });
    const { body } = await readSession(
      adapter,
      `${sessionCookieName()}=${sessionToken}`,
    );
    expect(body).toBeNull();
    expect(adapter.sessions.has(sessionToken)).toBe(false);
  });
});
