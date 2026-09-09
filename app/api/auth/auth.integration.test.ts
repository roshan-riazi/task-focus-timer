import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createForgotPasswordHandler,
  createLoginHandler,
  createLogoutHandler,
  createRegisterHandler,
  createResendVerificationHandler,
  createResetPasswordHandler,
  createSessionHandler,
  createVerifyEmailHandler,
  type HandlerDeps,
} from "@/lib/auth/handlers";
import type { AppSession } from "@/lib/auth/session";
import { parseSessionCookie, sessionCookieName } from "@/lib/auth/cookies";
import type { EmailMessage } from "@/lib/email/types";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

/**
 * Full register → use-before-verify → verify → login → reset journey against
 * real Postgres (issue 04 acceptance, TEST_STRATEGY §2). Handler factories
 * run with the production service + Prisma ports and a capturing mailer; the
 * session reader is Prisma-backed here (real `auth()` needs Next.js request
 * scope — it is proven by lib/auth/auth-compat.test.ts and the E2E journey).
 */
describeIfDb(
  "auth API journey (live Postgres)",
  () => {
  let db: PrismaClient;
  let deps: HandlerDeps;
  let sent: EmailMessage[];
  const createdUserIds: string[] = [];
  const currentToken: { value?: string } = {};

  async function setup() {
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
    };
  }

  function email(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}@example.com`;
  }

  function post(
    handler: (request: Request) => Promise<Response>,
    body: unknown,
  ): Promise<Response> {
    return handler(
      new Request("http://localhost:3000/api/auth/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  function tokenFromMail(index: number, path: string): string {
    const text = sent[index].text;
    const match = text.match(new RegExp(`${path}\\?token=([^\\s]+)`));
    if (!match) throw new Error(`expected ${path} link in mail #${index}`);
    return match[1];
  }

  function sessionTokenFrom(res: Response): string {
    const header = res.headers.get("set-cookie") ?? "";
    const token = parseSessionCookie(header);
    if (!token) throw new Error("expected a session cookie");
    return token;
  }

  afterEach(async () => {
    currentToken.value = undefined;
    if (db) {
      await db.user.deleteMany({
        where: { id: { in: createdUserIds.splice(0) } },
      });
    }
  });

  it("registers with normalized email, hashed password, bootstrapped settings, and a verification mail", async () => {
    await setup();
    const address = email("journey");
    const res = await post(createRegisterHandler(deps), {
      email: `  ${address.toUpperCase()} `,
      password: "s3cure-password",
      timezone: "Europe/Berlin",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { id: string; email: string };
      emailed: boolean;
    };
    expect(body.user.email).toBe(address);
    expect(body.emailed).toBe(true);
    createdUserIds.push(body.user.id);

    const row = await db.user.findUnique({
      where: { id: body.user.id },
      include: { settings: true },
    });
    expect(row?.email).toBe(address);
    expect(row?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row?.timezone).toBe("Europe/Berlin");
    expect(row?.emailVerified).toBeNull();
    // Settings-row bootstrap with spec §10.2 defaults.
    expect(row?.settings).toMatchObject({
      focusDurationSeconds: 1500,
      shortBreakSeconds: 300,
      longBreakSeconds: 900,
      intervalsBeforeLongBreak: 4,
      autoStartBreaks: false,
      autoStartFocus: false,
      soundEnabled: true,
      soundPreset: "chime",
      soundVolume: 80,
      notificationsEnabled: false,
    });
    // Only a SHA-256 hash is stored; the raw token travels by mail only.
    const tokens = await db.emailVerificationToken.findMany({
      where: { userId: body.user.id },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).toHaveLength(64);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(address);
    expect(sent[0].text).toContain("/verify-email?token=");
  });

  it("rejects duplicate (case-variant) registration with 409", async () => {
    await setup();
    const address = email("dupe");
    const handler = createRegisterHandler(deps);
    const first = await post(handler, {
      email: address,
      password: "s3cure-password",
    });
    expect(first.status).toBe(201);
    createdUserIds.push(
      ((await first.json()) as { user: { id: string } }).user.id,
    );
    const second = await post(handler, {
      email: address.toUpperCase(),
      password: "other-pass-1",
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as {
      error: { code: string };
    };
    expect(body.error.code).toBe("EMAIL_TAKEN");
    expect(await db.user.count({ where: { email: address } })).toBe(1);
  });

  it("rejects validation abuse with field-associated 400s", async () => {
    await setup();
    const handler = createRegisterHandler(deps);
    for (const payload of [
      { email: "not-an-email", password: "s3cure-password" },
      { email: email("ok"), password: "short" },
      { email: email("ok"), password: "a".repeat(73) },
      {
        email: email("ok"),
        password: "s3cure-password",
        timezone: "Mars/Olympus",
      },
    ]) {
      const res = await post(handler, payload);
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; fields: Record<string, string[]> };
      };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(body.error.fields).length).toBeGreaterThan(0);
    }
  });

  it("logs in unverified users (use-before-verify), reads the session, then verifies", async () => {
    await setup();
    const address = email("verify");
    const register = createRegisterHandler(deps);
    const registered = (await (
      await post(register, { email: address, password: "s3cure-password" })
    ).json()) as { user: { id: string } };
    createdUserIds.push(registered.user.id);

    // Wrong password and unknown email share one code.
    const login = createLoginHandler(deps);
    expect(
      (await post(login, { email: address, password: "wrong-pass-1" })).status,
    ).toBe(401);
    expect(
      (
        await post(login, {
          email: email("ghost"),
          password: "s3cure-password",
        })
      ).status,
    ).toBe(401);

    // Unverified login succeeds: nag, not a gate.
    const loggedIn = await post(login, {
      email: address,
      password: "s3cure-password",
    });
    expect(loggedIn.status).toBe(200);
    const loginBody = (await loggedIn.json()) as {
      user: { id: string; email: string; emailVerified: null };
    };
    expect(loginBody.user.email).toBe(address);
    expect(loginBody.user.emailVerified).toBeNull();
    currentToken.value = sessionTokenFrom(loggedIn);
    expect(
      await db.session.findUnique({
        where: { sessionToken: currentToken.value },
      }),
    ).toBeTruthy();

    // Session reflects the unverified state for the nag.
    const sessionRes = await createSessionHandler(deps)(
      new Request("http://localhost:3000/api/auth/session"),
    );
    expect(sessionRes.status).toBe(200);
    expect(await sessionRes.json()).toMatchObject({
      user: { id: registered.user.id, email: address, emailVerified: null },
    });

    // Verify via the emailed link; reuse and bogus tokens fail alike.
    const token = tokenFromMail(0, "/verify-email");
    const verify = createVerifyEmailHandler(deps);
    expect((await post(verify, { token })).status).toBe(200);
    expect(
      (await db.user.findUnique({ where: { id: registered.user.id } }))
        ?.emailVerified,
    ).toBeInstanceOf(Date);
    expect((await post(verify, { token })).status).toBe(400);
    expect((await post(verify, { token: "bogus" })).status).toBe(400);

    // Session now carries verification state; nag can clear.
    const after = await createSessionHandler(deps)(
      new Request("http://localhost:3000/api/auth/session"),
    );
    const afterBody = (await after.json()) as {
      user: { emailVerified: string | null };
    };
    expect(typeof afterBody.user.emailVerified).toBe("string");
  });

  it("resends verification only when signed in, invalidating the predecessor", async () => {
    await setup();
    const address = email("resend");
    const registered = (await (
      await post(createRegisterHandler(deps), {
        email: address,
        password: "s3cure-password",
      })
    ).json()) as { user: { id: string } };
    createdUserIds.push(registered.user.id);

    // Signed out: 401, no mail.
    const denied = await post(createResendVerificationHandler(deps), {});
    expect(denied.status).toBe(401);
    expect(sent).toHaveLength(1);

    // Signed in: fresh mail, old token dead.
    const loggedIn = await post(createLoginHandler(deps), {
      email: address,
      password: "s3cure-password",
    });
    currentToken.value = sessionTokenFrom(loggedIn);
    const first = tokenFromMail(0, "/verify-email");
    const resent = await post(createResendVerificationHandler(deps), {});
    expect(resent.status).toBe(200);
    expect(sent).toHaveLength(2);
    const verify = createVerifyEmailHandler(deps);
    expect((await post(verify, { token: first })).status).toBe(400);
    expect(
      (await post(verify, { token: tokenFromMail(1, "/verify-email") })).status,
    ).toBe(200);
  });

  it("runs the password-reset journey with session revocation and no enumeration", async () => {
    await setup();
    const address = email("reset");
    const registered = (await (
      await post(createRegisterHandler(deps), {
        email: address,
        password: "old-password-1",
      })
    ).json()) as { user: { id: string } };
    createdUserIds.push(registered.user.id);
    const loggedIn = await post(createLoginHandler(deps), {
      email: address,
      password: "old-password-1",
    });
    const staleToken = sessionTokenFrom(loggedIn);

    // Unknown emails succeed silently with no mail.
    const forgot = createForgotPasswordHandler(deps);
    const ghostMails = sent.length;
    expect((await post(forgot, { email: email("ghost") })).status).toBe(200);
    expect(sent).toHaveLength(ghostMails);

    // Known email gets a reset mail (normalized lookup).
    expect(
      (await post(forgot, { email: ` ${address.toUpperCase()} ` })).status,
    ).toBe(200);
    expect(sent).toHaveLength(ghostMails + 1);
    const token = tokenFromMail(sent.length - 1, "/reset-password");

    // Reset succeeds, clears the cookie, revokes sessions, burns the token.
    const reset = createResetPasswordHandler(deps);
    const done = await post(reset, {
      token,
      password: "brand-new-pass-2",
    });
    expect(done.status).toBe(200);
    expect(done.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
    expect(
      await db.session.findUnique({ where: { sessionToken: staleToken } }),
    ).toBeNull();
    expect((await post(reset, { token, password: "x".repeat(12) })).status).toBe(
      400,
    );

    // Old password dead, new password works.
    const login = createLoginHandler(deps);
    expect(
      (await post(login, { email: address, password: "old-password-1" })).status,
    ).toBe(401);
    const fresh = await post(login, {
      email: address,
      password: "brand-new-pass-2",
    });
    expect(fresh.status).toBe(200);
    currentToken.value = sessionTokenFrom(fresh);
    expect(
      await db.session.findUnique({
        where: { sessionToken: currentToken.value },
      }),
    ).toBeTruthy();
  });

  it("logs out by deleting the session (idempotent)", async () => {
    await setup();
    const address = email("logout");
    const registered = (await (
      await post(createRegisterHandler(deps), {
        email: address,
        password: "s3cure-password",
      })
    ).json()) as { user: { id: string } };
    createdUserIds.push(registered.user.id);
    const loggedIn = await post(createLoginHandler(deps), {
      email: address,
      password: "s3cure-password",
    });
    const token = sessionTokenFrom(loggedIn);

    const logout = createLogoutHandler(deps);
    const withCookie = new Request("http://localhost:3000/api/auth/logout", {
      method: "POST",
      headers: { cookie: `${sessionCookieName()}=${token}` },
    });
    const res = await logout(withCookie);
    expect(res.status).toBe(200);
    expect(
      await db.session.findUnique({ where: { sessionToken: token } }),
    ).toBeNull();
    // Twice: still 200.
    expect((await logout(withCookie)).status).toBe(200);
  });
  },
  // Bcrypt-bound (cost-12 hashes per register/login/reset); wall-clock, not
  // a hang. CI runners are slower than dev boxes.
  60_000,
);
