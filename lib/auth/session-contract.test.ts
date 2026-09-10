import { describe, expect, it } from "vitest";
import { createAuthConfig } from "./auth-config";
import { SESSION_MAX_AGE_SECONDS } from "./service";

describe("createAuthConfig (writer/reader contract)", () => {
  it("uses database sessions with the service session lifetime", () => {
    const config = createAuthConfig({} as never);
    expect(config.session?.strategy).toBe("database");
    expect(config.session?.maxAge).toBe(SESSION_MAX_AGE_SECONDS);
  });

  it("tracks the cookie helper for secure-cookie mode (no drift)", () => {
    const config = createAuthConfig({} as never);
    const secure = (process.env.APP_URL ?? "").startsWith("https://");
    expect(config.useSecureCookies).toBe(secure);
  });

  it("configures no OAuth providers in the MVP (credentials are app-managed)", () => {
    const config = createAuthConfig({} as never);
    expect(config.providers).toEqual([]);
  });

  it("trusts the host (self-hosted/Docker/VPS + 127.0.0.1 session reads)", () => {
    // No Auth.js redirects exist to poison (no OAuth), so host validation
    // buys nothing and breaks session reads off localhost.
    expect(createAuthConfig({} as never).trustHost).toBe(true);
  });

  it("maps the session callback to the app session shape (id, verified, tz)", async () => {
    const config = createAuthConfig({} as never);
    const callback = config.callbacks?.session;
    expect(callback).toBeTypeOf("function");
    const verifiedAt = new Date("2026-09-07T10:00:00.000Z");
    const result = await callback?.({
      session: { user: {}, expires: new Date().toISOString() },
      user: {
        id: "user-1",
        email: "alice@example.com",
        emailVerified: verifiedAt,
        timezone: "Europe/Berlin",
      },
      token: {},
    } as never);
    expect(result?.user).toMatchObject({
      id: "user-1",
      email: "alice@example.com",
      emailVerified: verifiedAt.toISOString(),
      timezone: "Europe/Berlin",
    });
    expect(result?.user).not.toHaveProperty("passwordHash");
  });

  it("defaults missing verification state and timezone (adapter-shaped gaps)", async () => {
    const config = createAuthConfig({} as never);
    const callback = config.callbacks?.session;
    const result = await callback?.({
      session: { user: {}, expires: new Date().toISOString() },
      user: { id: "user-2", email: "bob@example.com", emailVerified: null },
      token: {},
    } as never);
    expect(result?.user).toMatchObject({
      emailVerified: null,
      timezone: "UTC",
    });
  });
});
