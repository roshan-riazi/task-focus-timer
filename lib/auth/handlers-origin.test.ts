import { describe, expect, it, vi } from "vitest";
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
  createVerifyEmailHandler,
  type HandlerDeps,
} from "./handlers";
import { sessionCookieName } from "./cookies";

const APP_URL = "https://app.example";
const EVIL_ORIGIN = "https://evil.example";

function stubService(): AuthService {
  return {
    register: async () => ({
      user: { id: "u1", email: "a@x.com", emailVerified: null },
      emailed: true,
    }),
    login: async () => ({
      user: { id: "u1", email: "a@x.com", emailVerified: null },
      sessionToken: "sess-abc",
      expires: new Date("2026-10-08T12:00:00.000Z"),
    }),
    logout: async () => undefined,
    requestVerification: async () => ({ emailed: true }),
    verifyEmail: async () => ({ userId: "u1" }),
    forgotPassword: async () => undefined,
    resetPassword: async () => undefined,
    deleteAccount: async () => ({ deleted: true as const }),
  } as AuthService;}

const SIGNED_IN: AppSession = {
  user: {
    id: "u1",
    email: "a@x.com",
    emailVerified: null,
    timezone: "UTC",
  },
  expires: new Date("2026-10-08T12:00:00.000Z").toISOString(),
};

function deps(): HandlerDeps {
  return {
    getService: async () => stubService(),
    getSession: async () => SIGNED_IN,
    appUrl: APP_URL,
  };
}

function post(
  handler: (request: Request) => Promise<Response>,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return handler(
    new Request("https://app.example/api/auth/x", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function del(
  handler: (request: Request) => Promise<Response>,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return handler(
    new Request("https://app.example/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * HTTP-seam origin enforcement (issue 05): every auth mutation rejects a
 * mismatched Origin with a leak-free 403 before touching the service, and
 * lets matching origins through. GET /session is a safe method and skips
 * the gate.
 */
describe("auth mutation origin enforcement", () => {
  const mutations: Array<{
    name: string;
    run: (headers: Record<string, string>) => Promise<Response>;
  }> = [
    {
      name: "register",
      run: (headers) =>
        post(createRegisterHandler(deps()), { email: "a@x.com" }, headers),
    },
    {
      name: "login",
      run: (headers) =>
        post(createLoginHandler(deps()), { email: "a@x.com" }, headers),
    },
    {
      name: "logout",
      run: (headers) =>
        post(
          createLogoutHandler(deps()),
          {},
          { cookie: `${sessionCookieName()}=sess-abc`, ...headers },
        ),
    },
    {
      name: "verify-email",
      run: (headers) =>
        post(createVerifyEmailHandler(deps()), { token: "t" }, headers),
    },
    {
      name: "resend-verification",
      run: (headers) =>
        post(createResendVerificationHandler(deps()), {}, headers),
    },
    {
      name: "forgot-password",
      run: (headers) =>
        post(
          createForgotPasswordHandler(deps()),
          { email: "a@x.com" },
          headers,
        ),
    },
    {
      name: "reset-password",
      run: (headers) =>
        post(
          createResetPasswordHandler(deps()),
          { token: "t", password: "brand-new-pass-2" },
          headers,
        ),
    },
    {
      name: "delete-account",
      run: (headers) =>
        del(
          createDeleteAccountHandler(deps()),
          { confirmation: "DELETE" },
          headers,
        ),
    },
  ];

  for (const { name, run } of mutations) {
    it(`${name}: rejects a mismatched Origin with 403 ORIGIN_MISMATCH`, async () => {
      const res = await run({ origin: EVIL_ORIGIN });
      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("ORIGIN_MISMATCH");
      // Leak-free: no user content, no internals.
      expect(JSON.stringify(body)).not.toContain("a@x.com");
    });

    it(`${name}: allows the app origin through`, async () => {
      const res = await run({ origin: APP_URL });
      expect(res.status).not.toBe(403);
    });
  }

  it("login: does not reach the service when the origin mismatches", async () => {
    const login = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const handler = createLoginHandler({
      getService: async () => ({ ...stubService(), login }) as AuthService,
      getSession: async () => null,
      appUrl: APP_URL,
    });
    const res = await post(
      handler,
      { email: "a@x.com", password: "s3cure-password" },
      { origin: EVIL_ORIGIN },
    );
    expect(res.status).toBe(403);
    expect(login).not.toHaveBeenCalled();
  });
});
