import { describe, expect, it, vi } from "vitest";
import { AuthServiceError } from "./service";
import type { AuthService } from "./service";
import type { AppSession } from "./session";
import {
  createDeleteAccountHandler,
  createForgotPasswordHandler,
  createLoginHandler,
  createLogoutHandler,
  createRegisterHandler,
  createResendVerificationHandler,
  createResetPasswordHandler,
  createSessionHandler,
  createVerifyEmailHandler,
  type HandlerDeps,
} from "./handlers";
import { sessionCookieName } from "./cookies";

/**
 * Hermetic HTTP-seam tests: every handler runs against a stub service and a
 * stub session reader, so status codes, envelopes, and Set-Cookie behavior
 * are proven without Postgres or Next.js. Live-DB coverage of the same
 * handlers lands in app/api/auth/auth.integration.test.ts (CI).
 */
function stubService(overrides: Partial<AuthService> = {}): AuthService {
  const notImplemented = async (): Promise<never> => {
    throw new Error("not implemented in stub");
  };
  return {
    register: notImplemented,
    login: notImplemented,
    logout: async () => undefined,
    requestVerification: notImplemented,
    verifyEmail: notImplemented,
    forgotPassword: async () => undefined,
    resetPassword: async () => undefined,
    ...overrides,
  } as AuthService;
}

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    getService: async () => stubService(),
    getSession: async () => null,
    ...overrides,
  };
}

function jsonRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/auth/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function bodyOf(res: Response) {
  return (await res.json()) as {
    user?: unknown;
    emailed?: boolean;
    verified?: boolean;
    error?: { code: string; message: string; fields?: Record<string, string[]> };
  };
}

describe("POST register", () => {
  it("returns 201 with the user and emailed flag", async () => {
    const register = vi.fn(async () => ({
      user: { id: "u1", email: "alice@example.com", emailVerified: null },
      emailed: true,
    }));
    const handler = createRegisterHandler(
      deps({ getService: async () => stubService({ register }) }),
    );
    const res = await handler(
      jsonRequest({ email: "alice@example.com", password: "s3cure-password" }),
    );
    expect(res.status).toBe(201);
    expect(await bodyOf(res)).toEqual({
      user: { id: "u1", email: "alice@example.com", emailVerified: null },
      emailed: true,
    });
  });

  it("maps EMAIL_TAKEN to 409 and validation failures to a 400 field envelope", async () => {
    const taken = createRegisterHandler(
      deps({
        getService: async () =>
          stubService({
            register: async () => {
              throw new AuthServiceError(
                "EMAIL_TAKEN",
                "An account with this email already exists.",
              );
            },
          }),
      }),
    );
    const takenRes = await taken(
      jsonRequest({ email: "a@x.com", password: "s3cure-password" }),
    );
    expect(takenRes.status).toBe(409);
    expect((await bodyOf(takenRes)).error?.code).toBe("EMAIL_TAKEN");

    const invalid = createRegisterHandler(
      deps({
        getService: async () =>
          stubService({
            register: async () => {
              throw new AuthServiceError("VALIDATION_ERROR", "Bad.", {
                email: ["Enter a valid email address."],
              });
            },
          }),
      }),
    );
    const invalidRes = await invalid(jsonRequest({ email: "bad" }));
    expect(invalidRes.status).toBe(400);
    const invalidBody = await bodyOf(invalidRes);
    expect(invalidBody.error?.code).toBe("VALIDATION_ERROR");
    expect(invalidBody.error?.fields?.email).toHaveLength(1);
  });

  it("maps unexpected failures to a leak-free 500", async () => {
    const handler = createRegisterHandler(
      deps({
        getService: async () => {
          throw new Error("connect ECONNREFUSED postgres://secret@db:5432");
        },
      }),
    );
    const res = await handler(jsonRequest({}));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await bodyOf(res));
    expect(text).toEqual(
      expect.stringContaining("INTERNAL_ERROR"),
    );
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("postgres://");
  });
});

describe("POST login", () => {
  const verifiedAt = new Date("2026-09-07T10:00:00.000Z");

  it("sets the session cookie and returns the user incl. verification state", async () => {
    const login = vi.fn(async () => ({
      user: { id: "u1", email: "a@x.com", emailVerified: verifiedAt },
      sessionToken: "sess-abc",
      expires: new Date("2026-10-08T12:00:00.000Z"),
    }));
    const handler = createLoginHandler(
      deps({ getService: async () => stubService({ login }) }),
    );
    const res = await handler(
      jsonRequest({ email: "a@x.com", password: "s3cure-password" }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${sessionCookieName()}=sess-abc`);
    expect(setCookie).toContain("HttpOnly");
    const body = await bodyOf(res);
    expect(body.user).toMatchObject({ id: "u1", email: "a@x.com" });
  });

  it("maps bad credentials to 401 with the stable code", async () => {
    const handler = createLoginHandler(
      deps({
        getService: async () =>
          stubService({
            login: async () => {
              throw new AuthServiceError(
                "INVALID_CREDENTIALS",
                "Invalid email or password.",
              );
            },
          }),
      }),
    );
    const res = await handler(
      jsonRequest({ email: "a@x.com", password: "wrong-pass-1" }),
    );
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error?.code).toBe("INVALID_CREDENTIALS");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST logout", () => {
  it("clears the cookie and succeeds even with no session", async () => {
    const logout = vi.fn(async () => undefined);
    const handler = createLogoutHandler(
      deps({ getService: async () => stubService({ logout }) }),
    );
    // Cookie-authenticated mutations carry a same-origin Origin (issue 05
    // CSRF gate); the default app origin applies when deps omit appUrl.
    const origin = { origin: "http://localhost:3000" };
    const res = await handler(
      jsonRequest(
        {},
        { cookie: `${sessionCookieName()}=sess-abc`, ...origin },
      ),
    );
    expect(res.status).toBe(200);
    expect(logout).toHaveBeenCalledWith({ sessionToken: "sess-abc" });
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");

    const bare = await handler(jsonRequest({}, origin));
    expect(bare.status).toBe(200);
    expect(logout).toHaveBeenCalledWith({ sessionToken: undefined });
  });
});

describe("GET session", () => {
  it("returns the app session user (nag state included)", async () => {
    const appSession: AppSession = {
      user: {
        id: "u1",
        email: "a@x.com",
        emailVerified: null,
        timezone: "Europe/Berlin",
      },
      expires: new Date("2026-10-08T12:00:00.000Z").toISOString(),
    };
    const handler = createSessionHandler(
      deps({ getSession: async () => appSession }),
    );
    const res = await handler(new Request("http://localhost/api/auth/session"));
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ user: appSession.user });
  });

  it("returns a null user when signed out", async () => {
    const handler = createSessionHandler(deps());
    const res = await handler(new Request("http://localhost/api/auth/session"));
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ user: null });
  });
});

describe("POST verify-email", () => {
  it("returns verified:true on success and 400 on stale tokens", async () => {
    const ok = createVerifyEmailHandler(
      deps({
        getService: async () =>
          stubService({ verifyEmail: async () => ({ userId: "u1" }) }),
      }),
    );
    const okRes = await ok(jsonRequest({ token: "good" }));
    expect(okRes.status).toBe(200);
    expect((await bodyOf(okRes)).verified).toBe(true);

    const stale = createVerifyEmailHandler(
      deps({
        getService: async () =>
          stubService({
            verifyEmail: async () => {
              throw new AuthServiceError(
                "INVALID_TOKEN",
                "This link is invalid or has expired.",
              );
            },
          }),
      }),
    );
    const staleRes = await stale(jsonRequest({ token: "stale" }));
    expect(staleRes.status).toBe(400);
    expect((await bodyOf(staleRes)).error?.code).toBe("INVALID_TOKEN");
  });
});

describe("POST resend-verification", () => {
  const appSession: AppSession = {
    user: {
      id: "u1",
      email: "a@x.com",
      emailVerified: null,
      timezone: "UTC",
    },
    expires: new Date().toISOString(),
  };

  it("requires a session (401 when signed out)", async () => {
    const handler = createResendVerificationHandler(deps());
    const res = await handler(jsonRequest({}));
    expect(res.status).toBe(401);
    expect((await bodyOf(res)).error?.code).toBe("UNAUTHENTICATED");
  });

  it("forwards the session user id and returns the emailed flag", async () => {
    const requestVerification = vi.fn(async () => ({ emailed: true }));
    const handler = createResendVerificationHandler(
      deps({
        getSession: async () => appSession,
        getService: async () => stubService({ requestVerification }),
      }),
    );
    const res = await handler(jsonRequest({}));
    expect(res.status).toBe(200);
    expect(requestVerification).toHaveBeenCalledWith({ userId: "u1" });
    expect((await bodyOf(res)).emailed).toBe(true);
  });

  it("ignores a forged userId in the body (identity comes from the session)", async () => {
    const requestVerification = vi.fn(async () => ({ emailed: true }));
    const handler = createResendVerificationHandler(
      deps({
        getSession: async () => appSession,
        getService: async () => stubService({ requestVerification }),
      }),
    );
    const res = await handler(jsonRequest({ userId: "victim-id" }));
    expect(res.status).toBe(200);
    expect(requestVerification).toHaveBeenCalledWith({ userId: "u1" });
  });
});

describe("POST forgot-password", () => {
  it("always returns 200 (no enumeration)", async () => {
    const forgotPassword = vi.fn(async () => undefined);
    const handler = createForgotPasswordHandler(
      deps({ getService: async () => stubService({ forgotPassword }) }),
    );
    const res = await handler(jsonRequest({ email: "ghost@example.com" }));
    expect(res.status).toBe(200);
    expect(forgotPassword).toHaveBeenCalled();
  });
});

describe("POST reset-password", () => {
  it("clears the session cookie on success (sessions revoked)", async () => {
    const resetPassword = vi.fn(async () => undefined);
    const handler = createResetPasswordHandler(
      deps({ getService: async () => stubService({ resetPassword }) }),
    );
    const res = await handler(
      jsonRequest({ token: "t", password: "brand-new-pass-2" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });

  it("maps stale tokens to 400 without clearing the cookie", async () => {
    const handler = createResetPasswordHandler(
      deps({
        getService: async () =>
          stubService({
            resetPassword: async () => {
              throw new AuthServiceError(
                "INVALID_TOKEN",
                "This link is invalid or has expired.",
              );
            },
          }),
      }),
    );
    const res = await handler(jsonRequest({ token: "stale", password: "x".repeat(12) }));
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

/**
 * DELETE /api/account (issue 18, spec §8.1): explicit DELETE confirmation,
 * session-derived identity, cleared cookie on success. CSRF + rate-limit
 * gates ride the shared `withMutationGates` wrapper (pinned in
 * handlers-origin.test.ts / handlers-ratelimit.test.ts).
 */
describe("DELETE account", () => {
  const SIGNED_IN: AppSession = {
    user: { id: "u1", email: "a@x.com", emailVerified: null, timezone: "UTC" },
    expires: new Date("2026-10-08T12:00:00.000Z").toISOString(),
  };

  function deleteRequest(
    body: unknown,
    headers: Record<string, string> = {},
  ): Request {
    return new Request("http://localhost:3000/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  function accountDeps(
    overrides: Partial<HandlerDeps> = {},
  ): HandlerDeps {
    return deps({
      getSession: async () => SIGNED_IN,
      ...overrides,
    });
  }

  it("returns 401 without a session, never reaching the service", async () => {
    const deleteAccount = vi.fn(async (): Promise<{ deleted: true }> => ({ deleted: true }));
    const handler = createDeleteAccountHandler(
      accountDeps({
        getSession: async () => null,
        getService: async () => stubService({ deleteAccount }),
      }),
    );
    const res = await handler(deleteRequest({ confirmation: "DELETE" }));
    expect(res.status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("returns 400 with field errors when the service rejects the confirmation", async () => {
    const deleteAccount = vi.fn(async () => {
      throw new AuthServiceError("VALIDATION_ERROR", "Check the highlighted fields and try again.", {
        confirmation: ["Type DELETE to confirm account deletion."],
      });
    });
    const handler = createDeleteAccountHandler(
      accountDeps({ getService: async () => stubService({ deleteAccount }) }),
    );
    const res = await handler(
      deleteRequest({ confirmation: "delete" }, { origin: "http://localhost:3000" }),
    );
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(body.error?.fields?.confirmation?.length).toBeGreaterThan(0);
    expect(deleteAccount).toHaveBeenCalledOnce();
  });

  it("deletes by session identity (forged body ids reach nothing) and clears the cookie", async () => {
    const deleteAccount = vi.fn(
      async (_userId: string): Promise<{ deleted: true }> => ({
        deleted: true,
      }),
    );
    const handler = createDeleteAccountHandler(
      accountDeps({ getService: async () => stubService({ deleteAccount }) }),
    );
    const res = await handler(
      deleteRequest(
        { confirmation: "DELETE", userId: "victim-id" },
        { origin: "http://localhost:3000" },
      ),
    );
    expect(res.status).toBe(200);
    expect(deleteAccount).toHaveBeenCalledOnce();
    expect(deleteAccount.mock.calls[0][0]).toBe("u1");
    expect(await res.json()).toEqual({ deleted: true });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(sessionCookieName());
    expect(setCookie).toContain("Max-Age=0");
  });

  it("rejects a mismatched Origin with 403 before the service runs", async () => {
    const deleteAccount = vi.fn(async (): Promise<{ deleted: true }> => ({ deleted: true }));
    const handler = createDeleteAccountHandler(
      accountDeps({
        getService: async () => stubService({ deleteAccount }),
        appUrl: "https://app.example",
      }),
    );
    const res = await handler(
      deleteRequest(
        { confirmation: "DELETE" },
        { origin: "https://evil.example" },
      ),
    );
    expect(res.status).toBe(403);
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when the rate budget is spent", async () => {
    const deleteAccount = vi.fn(async (): Promise<{ deleted: true }> => ({ deleted: true }));
    const handler = createDeleteAccountHandler(
      accountDeps({
        getService: async () => stubService({ deleteAccount }),
        rateLimit: async () => ({
          allowed: false,
          retryAfterSeconds: 42,
          resetAt: new Date("2026-09-08T12:01:00.000Z"),
        }),
      }),
    );
    const res = await handler(
      deleteRequest(
        { confirmation: "DELETE" },
        { origin: "http://localhost:3000" },
      ),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
