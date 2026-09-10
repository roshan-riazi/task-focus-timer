import { describe, expect, it } from "vitest";
import {
  parseSessionCookie,
  serializeClearSessionCookie,
  serializeSessionCookie,
  sessionCookieName,
} from "./cookies";

describe("session cookie serialization (Auth.js-shaped)", () => {
  it("round-trips a token through serialize + parse", () => {
    const header = serializeSessionCookie(
      "tok-123",
      new Date("2026-10-08T12:00:00.000Z"),
    );
    expect(header).toContain(`${sessionCookieName()}=tok-123`);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(parseSessionCookie(header)).toBe("tok-123");
  });

  it("parses the token out of a multi-cookie header", () => {
    const header = `other=1; ${sessionCookieName()}=abc-xyz; theme=dark`;
    expect(parseSessionCookie(header)).toBe("abc-xyz");
  });

  it("returns undefined when the cookie is absent", () => {
    expect(parseSessionCookie(null)).toBeUndefined();
    expect(parseSessionCookie("other=1; theme=dark")).toBeUndefined();
  });

  it("serializes a clearing cookie that expires immediately", () => {
    const header = serializeClearSessionCookie();
    expect(header).toContain(`${sessionCookieName()}=`);
    expect(header).toMatch(/Max-Age=0/i);
  });

  it("marks Secure only over https (mirrors sessionCookieConfig)", () => {
    const header = serializeSessionCookie("t", new Date());
    const secure = (process.env.APP_URL ?? "").startsWith("https://");
    expect(header.includes("Secure")).toBe(secure);
  });
});
