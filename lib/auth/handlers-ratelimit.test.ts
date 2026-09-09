import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "./service";
import {
  createLoginHandler,
  createRegisterHandler,
  type HandlerDeps,
} from "./handlers";

const APP_URL = "https://app.example";

function deps(rateLimit: HandlerDeps["rateLimit"]): HandlerDeps {
  const notImplemented = async (): Promise<never> => {
    throw new Error("not implemented in stub");
  };
  return {
    getService: async () =>
      ({
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
        requestVerification: notImplemented,
        verifyEmail: notImplemented,
        forgotPassword: async () => undefined,
        resetPassword: async () => undefined,
      }) as AuthService,
    getSession: async () => null,
    appUrl: APP_URL,
    rateLimit,
  };
}

function loginRequest(): Request {
  return new Request("https://app.example/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APP_URL,
    },
    body: JSON.stringify({ email: "a@x.com", password: "s3cure-password" }),
  });
}

/**
 * HTTP-seam rate limiting (issue 05, spec §8.1): an exhausted budget rejects
 * with a leak-free 429 + Retry-After before the service runs; a healthy
 * budget passes through untouched.
 */
describe("auth rate-limit enforcement", () => {
  it("returns 429 RATE_LIMITED with Retry-After when the budget is spent", async () => {
    const login = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const base = deps(async () => ({
      allowed: false,
      retryAfterSeconds: 42,
      resetAt: new Date("2026-09-09T10:01:00.000Z"),
    }));
    const handler = createLoginHandler({
      ...base,
      getService: async () => ({ ...(await base.getService()), login }),
    });
    const res = await handler(loginRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(JSON.stringify(body)).not.toContain("a@x.com");
    expect(login).not.toHaveBeenCalled();
  });

  it("passes legitimate traffic through when budget remains", async () => {
    const check = vi.fn(async () => ({
      allowed: true,
      retryAfterSeconds: 0,
      resetAt: new Date("2026-09-09T10:01:00.000Z"),
    }));
    const handler = createLoginHandler(deps(check));
    const res = await handler(loginRequest());
    expect(res.status).toBe(200);
    expect(check).toHaveBeenCalledOnce();
  });

  it("checks the free origin gate before spending a rate-limit hit", async () => {
    const check = vi.fn(async () => ({
      allowed: true,
      retryAfterSeconds: 0,
      resetAt: new Date(),
    }));
    const handler = createRegisterHandler(deps(check));
    const res = await handler(
      new Request("https://app.example/api/auth/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(403);
    expect(check).not.toHaveBeenCalled();
  });
});
