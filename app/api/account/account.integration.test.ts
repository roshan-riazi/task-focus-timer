import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createDeleteAccountHandler,
  type HandlerDeps,
} from "@/lib/auth/handlers";
import type { AuthService } from "@/lib/auth/service";
import type { AppSession } from "@/lib/auth/session";
import type { EmailMessage } from "@/lib/email/types";
import {
  AUTH_RATE_LIMITS,
  bucketKey,
  checkRateLimit,
  clientIp,
} from "@/lib/rate-limit/limiter";
import { createPrismaRateLimitStore } from "@/lib/rate-limit/prisma-store";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

const APP_URL = "http://localhost:3000";

/**
 * Account deletion against live Postgres (issue 18, spec §8.1/§12.2):
 *
 * - DELETE with the DELETE literal purges the user row plus every
 *   user-linked row (settings, tasks, timer sessions + snapshots, cycle
 *   state, idempotency keys, auth sessions, email tokens) and clears the
 *   session cookie.
 * - The dead session reads as signed-out afterwards (second DELETE → 401).
 * - A wrong confirmation 400s with field errors and preserves the account.
 * - The freed email re-registers cleanly (uniqueness released).
 */
describeIfDb(
  "DELETE /api/account (live Postgres)",
  () => {
    let db: PrismaClient;
    let service: AuthService;
    let deps: HandlerDeps;
    const createdUserIds: string[] = [];
    const currentToken: { value?: string } = {};

    async function setup(): Promise<void> {
      const mod = await import("@/lib/db");
      db = mod.db;
      const { createAuthService } = await import("@/lib/auth/service");
      const { createPrismaPorts } = await import("@/lib/auth/prisma-store");
      service = createAuthService(
        createPrismaPorts(db, {
          now: () => new Date(),
          appUrl: APP_URL,
          mailer: {
            name: "fake",
            send: async (_message: EmailMessage) => ({}),
          },
        }),
      );
      deps = {
        getService: async () => service,
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
      };
    }

    function email(prefix: string): string {
      return `${prefix}-${crypto.randomUUID()}@example.com`;
    }

    function del(body: unknown): Promise<Response> {
      return createDeleteAccountHandler(deps)(
        new Request(`${APP_URL}/api/account`, {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            origin: APP_URL,
          },
          body: JSON.stringify(body),
        }),
      );
    }

    /** A lived-in account: settings, task, session history, cycle, tokens. */
    async function makeLivedInUser(prefix: string): Promise<{
      id: string;
      email: string;
      sessionToken: string;
    }> {
      const address = email(prefix);
      const user = await db.user.create({
        data: { email: address, passwordHash: "hash" },
      });
      createdUserIds.push(user.id);
      await db.userSettings.create({ data: { userId: user.id } });
      const task = await db.task.create({
        data: { userId: user.id, title: "Doomed task", position: 1 },
      });
      const now = new Date();
      const timerSession = await db.timerSession.create({
        data: {
          userId: user.id,
          taskId: task.id,
          taskTitleSnapshot: "Doomed task",
          intervalType: "focus",
          status: "completed",
          plannedDurationSeconds: 1500,
          actualDurationSeconds: 1500,
          startedAt: now,
          expectedEndAt: new Date(now.getTime() + 1500_000),
          completedAt: new Date(now.getTime() + 1500_000),
        },
      });
      await db.focusCycleState.create({
        data: { userId: user.id, completedFocusCount: 3 },
      });
      await db.timerIdempotencyKey.create({
        data: { userId: user.id, key: "key-1", sessionId: timerSession.id },
      });
      const sessionToken = `sess-${crypto.randomUUID()}`;
      await db.session.create({
        data: {
          sessionToken,
          userId: user.id,
          expires: new Date(Date.now() + 3_600_000),
        },
      });
      await db.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: `vh-${crypto.randomUUID()}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      await db.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: `rh-${crypto.randomUUID()}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      return { id: user.id, email: address, sessionToken };
    }

    async function countsFor(userId: string) {
      const [user, settings, tasks, sessions, cycle, idempotency, auth, verify, reset] =
        await Promise.all([
          db.user.count({ where: { id: userId } }),
          db.userSettings.count({ where: { userId } }),
          db.task.count({ where: { userId } }),
          db.timerSession.count({ where: { userId } }),
          db.focusCycleState.count({ where: { userId } }),
          db.timerIdempotencyKey.count({ where: { userId } }),
          db.session.count({ where: { userId } }),
          db.emailVerificationToken.count({ where: { userId } }),
          db.passwordResetToken.count({ where: { userId } }),
        ]);
      return { user, settings, tasks, sessions, cycle, idempotency, auth, verify, reset };
    }

    afterEach(async () => {
      currentToken.value = undefined;
      if (db) {
        await db.user.deleteMany({
          where: { id: { in: createdUserIds.splice(0) } },
        });
      }
    });

    it("purges every user-linked row and clears the session cookie", async () => {
      await setup();
      const lived = await makeLivedInUser("purge");
      currentToken.value = lived.sessionToken;
      const before = await countsFor(lived.id);
      expect(before).toEqual({
        user: 1,
        settings: 1,
        tasks: 1,
        sessions: 1,
        cycle: 1,
        idempotency: 1,
        auth: 1,
        verify: 1,
        reset: 1,
      });

      const res = await del({ confirmation: "DELETE" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: true });
      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("Max-Age=0");

      expect(await countsFor(lived.id)).toEqual({
        user: 0,
        settings: 0,
        tasks: 0,
        sessions: 0,
        cycle: 0,
        idempotency: 0,
        auth: 0,
        verify: 0,
        reset: 0,
      });

      // The purged session reads as signed-out: a repeat DELETE is a 401,
      // not a leak about whether the account ever existed.
      const again = await del({ confirmation: "DELETE" });
      expect(again.status).toBe(401);
    });

    it("rejects a wrong confirmation with 400 field errors and keeps the account", async () => {
      await setup();
      const lived = await makeLivedInUser("nodelete");
      currentToken.value = lived.sessionToken;

      const res = await del({ confirmation: "delete" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error?: { code?: string; fields?: Record<string, string[]> };
      };
      expect(body.error?.code).toBe("VALIDATION_ERROR");
      expect(body.error?.fields?.confirmation?.length).toBeGreaterThan(0);

      const counts = await countsFor(lived.id);
      expect(counts.user).toBe(1);
      expect(counts.tasks).toBe(1);
    });

    it("throttles repeated deletion attempts with 429 + Retry-After (live bucket)", async () => {
      await setup();
      const lived = await makeLivedInUser("throttled");
      currentToken.value = lived.sessionToken;
      // Unique caller IP per run: the bucket is per-IP, so this isolates
      // the test from every other suite sharing the table (same pattern
      // as the unique store keys in session-scoping.integration.test.ts).
      const ip = `10.200.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
      // Production limiter wiring (lib/auth/request.ts prodDeps shape):
      // DB-backed fixed window over the real `rate_limit_hits` table.
      const throttledDeps: HandlerDeps = {
        ...deps,
        rateLimit: (request) =>
          checkRateLimit(
            createPrismaRateLimitStore(db),
            AUTH_RATE_LIMITS["account:delete"],
            bucketKey("account:delete", clientIp(request)),
            new Date(),
          ),
      };
      function attempt(): Promise<Response> {
        return createDeleteAccountHandler(throttledDeps)(
          new Request(`${APP_URL}/api/account`, {
            method: "DELETE",
            headers: {
              "content-type": "application/json",
              origin: APP_URL,
              "x-forwarded-for": ip,
            },
            body: JSON.stringify({ confirmation: "nope" }),
          }),
        );
      }
      // Five wrong confirmations reach the service (400s, budget spent).
      for (let i = 0; i < 5; i += 1) {
        expect(await (await attempt()).status).toBe(400);
      }
      // Sixth attempt never reaches the service: 429 + Retry-After.
      const limited = await attempt();
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      // The throttle fired before the service ran: nothing was purged.
      expect((await countsFor(lived.id)).user).toBe(1);
    });

    it("frees the email address for re-registration", async () => {
      await setup();
      const lived = await makeLivedInUser("reuse");
      currentToken.value = lived.sessionToken;

      expect((await del({ confirmation: "DELETE" })).status).toBe(200);
      const again = await service.register({
        email: lived.email,
        password: "brand-new-pass-1",
      });
      createdUserIds.push(again.user.id);
      expect(again.user.email).toBe(lived.email);
    });
  },
);
