import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createForgotPasswordHandler,
  createLoginHandler,
  createLogoutHandler,
  createRegisterHandler,
  createResendVerificationHandler,
  createSessionHandler,
  type HandlerDeps,
} from "@/lib/auth/handlers";
import { requireUser } from "@/lib/auth/guards";
import { parseSessionCookie, sessionCookieName } from "@/lib/auth/cookies";
import type { AppSession } from "@/lib/auth/session";
import type { EmailMessage } from "@/lib/email/types";
import { checkRateLimit } from "@/lib/rate-limit/limiter";
import { createPrismaRateLimitStore } from "@/lib/rate-limit/prisma-store";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

const APP_URL = "http://localhost:3000";

/**
 * Issue 05 acceptance against live Postgres (TEST_STRATEGY §2):
 *
 * - Session lifecycle: login issues a cookie session that survives across
 *   requests (the refresh story — same cookie, new request, same user),
 *   expired sessions read as signed-out, logout revokes, and login prunes
 *   expired rows (lazy cleanup, no workers).
 * - Rate limits: a DB-backed fixed-window budget enforced through the HTTP
 *   seam rejects with 429 + Retry-After while legitimate traffic passes.
 * - Cross-user isolation, both directions: session reads return only the
 *   token owner; session-gated mutations act on the session user even with
 *   a forged body id; scoped store reads return own rows and null for
 *   foreign rows (the pattern every future guarded route must follow).
 */
describeIfDb(
  "auth sessions, rate limits, and scoping (live Postgres)",
  () => {
    let db: PrismaClient;
    let sent: EmailMessage[];
    const createdUserIds: string[] = [];
    const currentToken: { value?: string } = {};

    function makeDeps(
      overrides: Partial<HandlerDeps> = {},
    ): HandlerDeps {
      return {
        getService: async () => {
          throw new Error("call setup() first");
        },
        getSession: async (): Promise<AppSession | null> => {
          if (!currentToken.value) return null;
          const row = await db.session.findUnique({
            where: { sessionToken: currentToken.value },
            include: { user: true },
          });
          if (!row || row.expires <= new Date()) return null;
          return {
            user: {
              id: row.user.id,
              email: row.user.email,
              emailVerified: row.user.emailVerified?.toISOString() ?? null,
              timezone: row.user.timezone,
            },
            expires: row.expires.toISOString(),
          };
        },
        appUrl: APP_URL,
        ...overrides,
      };
    }

    async function setup(overrides: Partial<HandlerDeps> = {}) {
      const mod = await import("@/lib/db");
      db = mod.db;
      sent = [];
      const { createAuthService } = await import("@/lib/auth/service");
      const { createPrismaPorts } = await import("@/lib/auth/prisma-store");
      const service = createAuthService(
        createPrismaPorts(db, {
          now: () => new Date(),
          appUrl: "https://app.example",
          mailer: {
            name: "fake",
            send: async (message: EmailMessage) => {
              sent.push(message);
              return {};
            },
          },
        }),
      );
      return makeDeps({ getService: async () => service, ...overrides });
    }

    function email(prefix: string): string {
      return `${prefix}-${crypto.randomUUID()}@example.com`;
    }

    function post(
      handler: (request: Request) => Promise<Response>,
      body: unknown,
      headers: Record<string, string> = {},
    ): Promise<Response> {
      return handler(
        new Request("http://localhost:3000/api/auth/x", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: APP_URL,
            ...headers,
          },
          body: JSON.stringify(body),
        }),
      );
    }

    function sessionTokenFrom(res: Response): string {
      const token = parseSessionCookie(res.headers.get("set-cookie") ?? "");
      if (!token) throw new Error("expected a session cookie");
      return token;
    }

    async function registerAndLogin(
      deps: HandlerDeps,
      address: string,
      password = "s3cure-password",
    ): Promise<{ userId: string; token: string }> {
      const registered = (await (
        await post(createRegisterHandler(deps), {
          email: address,
          password,
        })
      ).json()) as { user: { id: string } };
      createdUserIds.push(registered.user.id);
      const loggedIn = await post(createLoginHandler(deps), {
        email: address,
        password,
      });
      expect(loggedIn.status).toBe(200);
      return { userId: registered.user.id, token: sessionTokenFrom(loggedIn) };
    }

    afterEach(async () => {
      currentToken.value = undefined;
      if (db) {
        await db.rateLimitHit.deleteMany({
          where: { key: { startsWith: "test-05" } },
        });
        await db.user.deleteMany({
          where: { id: { in: createdUserIds.splice(0) } },
        });
      }
    });

    it("session survives across requests until logout revokes it", async () => {
      const deps = await setup();
      const address = email("lifecycle");
      const { userId, token } = await registerAndLogin(deps, address);

      // A later request bearing the same cookie (the refresh story) reads
      // the same user.
      currentToken.value = token;
      const sessionRes = await createSessionHandler(deps)(
        new Request("http://localhost:3000/api/auth/session"),
      );
      expect(await sessionRes.json()).toMatchObject({
        user: { id: userId, email: address },
      });

      // Logout revokes: the same cookie reads as signed-out afterwards.
      const logoutRes = await createLogoutHandler(deps)(
        new Request("http://localhost:3000/api/auth/logout", {
          method: "POST",
          headers: { cookie: `${sessionCookieName()}=${token}`, origin: APP_URL },
        }),
      );
      expect(logoutRes.status).toBe(200);
      const after = await createSessionHandler(deps)(
        new Request("http://localhost:3000/api/auth/session"),
      );
      expect(await after.json()).toEqual({ user: null });
    });

    it("expired sessions read as signed-out and are pruned on next login", async () => {
      const deps = await setup();
      const address = email("expiry");
      const { userId, token } = await registerAndLogin(deps, address);

      await db.session.update({
        where: { sessionToken: token },
        data: { expires: new Date(Date.now() - 1000) },
      });
      currentToken.value = token;
      const stale = await createSessionHandler(deps)(
        new Request("http://localhost:3000/api/auth/session"),
      );
      expect(await stale.json()).toEqual({ user: null });

      const fresh = await post(createLoginHandler(deps), {
        email: address,
        password: "s3cure-password",
      });
      expect(fresh.status).toBe(200);
      // The expired row is gone; exactly the fresh session remains.
      expect(
        await db.session.findUnique({ where: { sessionToken: token } }),
      ).toBeNull();
      expect(await db.session.count({ where: { userId } })).toBe(1);
    });

    it("enforces a DB-backed budget through the HTTP seam (429 + Retry-After)", async () => {
      const storeKey = `test-05-forgot-${crypto.randomUUID()}`;
      const deps = await setup({
        rateLimit: async () =>
          checkRateLimit(
            createPrismaRateLimitStore(db),
            { limit: 2, windowMs: 60_000 },
            storeKey,
            new Date(),
          ),
      });
      const handler = createForgotPasswordHandler(deps);
      const payload = { email: email("throttled") };

      expect((await post(handler, payload)).status).toBe(200);
      expect((await post(handler, payload)).status).toBe(200);
      const limited = await post(handler, payload);
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toMatch(/^[1-9]\d*$/);
      const body = (await limited.json()) as {
        error: { code: string };
      };
      expect(body.error.code).toBe("RATE_LIMITED");
    });

    it("isolates session reads by token owner, both directions", async () => {
      const deps = await setup();
      const a = await registerAndLogin(deps, email("owner-a"));
      const b = await registerAndLogin(deps, email("owner-b"));

      const readAs = async (token: string) => {
        const handler = createSessionHandler({
          ...deps,
          getSession: async (): Promise<AppSession | null> => {
            const row = await db.session.findUnique({
              where: { sessionToken: token },
              include: { user: true },
            });
            if (!row || row.expires <= new Date()) return null;
            return {
              user: {
                id: row.user.id,
                email: row.user.email,
                emailVerified: row.user.emailVerified?.toISOString() ?? null,
                timezone: row.user.timezone,
              },
              expires: row.expires.toISOString(),
            };
          },
        });
        const res = await handler(
          new Request("http://localhost:3000/api/auth/session"),
        );
        return (await res.json()) as {
          user: { id: string; email: string } | null;
        };
      };

      // A → B: A's token never yields B's identity, and vice versa.
      expect((await readAs(a.token)).user?.id).toBe(a.userId);
      expect((await readAs(b.token)).user?.id).toBe(b.userId);
      expect((await readAs(a.token)).user?.id).not.toBe(b.userId);
      expect((await readAs(b.token)).user?.id).not.toBe(a.userId);
    });

    it("session-gated mutations act on the session user despite a forged body id", async () => {
      const deps = await setup();
      const a = await registerAndLogin(deps, email("resend-a"));
      const b = await registerAndLogin(deps, email("resend-b"));
      const mailsBefore = sent.length;
      const bTokensBefore = await db.emailVerificationToken.count({
        where: { userId: b.userId },
      });

      currentToken.value = a.token;
      const res = await post(createResendVerificationHandler(deps), {
        userId: b.userId,
      });
      expect(res.status).toBe(200);
      // The mail went to A (the session owner), never to B.
      expect(sent).toHaveLength(mailsBefore + 1);
      expect(sent[sent.length - 1].to).not.toContain("resend-b");
      expect(await db.emailVerificationToken.count({
        where: { userId: b.userId },
      })).toBe(bTokensBefore);
    });

    it("scoped store reads return own rows and null for foreign rows, both directions", async () => {
      const deps = await setup();
      const a = await registerAndLogin(deps, email("tasks-a"));
      const b = await registerAndLogin(deps, email("tasks-b"));

      const taskA = await db.task.create({
        data: { userId: a.userId, title: "Task A", position: 1 },
      });
      const taskB = await db.task.create({
        data: { userId: b.userId, title: "Task B", position: 1 },
      });

      // The scoping pattern every guarded route follows: identity from
      // requireUser (token-bound, both directions), then `userId` in every
      // query predicate — foreign rows read as null, exactly like missing.
      async function scopedTask(
        token: string,
        taskId: string,
      ): Promise<string | null> {
        currentToken.value = token;
        const auth = await requireUser(deps, "req-test");
        if (!auth.ok) return null;
        const scoped = await db.task.findFirst({
          where: { id: taskId, userId: auth.user.id },
        });
        return scoped?.title ?? null;
      }

      expect(await scopedTask(a.token, taskA.id)).toBe("Task A");
      expect(await scopedTask(b.token, taskB.id)).toBe("Task B");
      expect(await scopedTask(a.token, taskB.id)).toBeNull();
      expect(await scopedTask(b.token, taskA.id)).toBeNull();

      // Guard identity itself is token-bound: A's token resolves A's id for
      // every downstream predicate, so A's settings row is unreachable
      // through B's session and vice versa.
      currentToken.value = a.token;
      const authA = await requireUser(deps, "req-a");
      currentToken.value = b.token;
      const authB = await requireUser(deps, "req-b");
      expect(authA.ok && authB.ok).toBe(true);
      if (authA.ok && authB.ok) {
        expect(authA.user.id).toBe(a.userId);
        expect(authB.user.id).toBe(b.userId);
        const seenByB = await db.userSettings.findFirst({
          where: { userId: authB.user.id },
        });
        expect(seenByB?.userId).toBe(b.userId);
        const seenByA = await db.userSettings.findFirst({
          where: { userId: authA.user.id },
        });
        expect(seenByA?.userId).toBe(a.userId);
      }
    });
  },
  60_000,
);
