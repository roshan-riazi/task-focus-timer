import { describe, expect, it } from "vitest";
import { isAllowedMutationOrigin } from "./origin";
import { sessionCookieName } from "./cookies";

const APP_URL = "https://app.example";

function mutation(
  headers: Record<string, string> = {},
  method = "POST",
): Request {
  return new Request("https://app.example/api/auth/login", {
    method,
    headers,
  });
}

/**
 * CSRF seam (issue 05, SYSTEM_DESIGN §3): cookie-authenticated mutations
 * require a matching Origin/Referer. Safe methods skip the check;
 * unauthenticated mutations without any origin headers stay usable by
 * non-browser callers, while any session-cookie request without a proven
 * origin fails closed.
 */
describe("isAllowedMutationOrigin", () => {
  it("allows safe methods without any origin headers", () => {
    expect(mutation({}, "GET").method).toBe("GET");
    expect(isAllowedMutationOrigin(mutation({}, "GET"), APP_URL)).toBe(true);
    expect(isAllowedMutationOrigin(mutation({}, "HEAD"), APP_URL)).toBe(true);
  });

  it("allows a mutation whose Origin matches the app origin", () => {
    const request = mutation({ origin: "https://app.example" });
    expect(isAllowedMutationOrigin(request, APP_URL)).toBe(true);
  });

  it("blocks a mutation whose Origin differs (exact origin compare)", () => {
    for (const origin of [
      "https://evil.example",
      "http://app.example",
      "https://app.example.evil.example",
      "https://app.example:8443",
    ]) {
      expect(isAllowedMutationOrigin(mutation({ origin }), APP_URL)).toBe(
        false,
      );
    }
  });

  it("falls back to Referer when Origin is absent", () => {
    const ok = mutation({ referer: "https://app.example/login" });
    expect(isAllowedMutationOrigin(ok, APP_URL)).toBe(true);
    const bad = mutation({ referer: "https://evil.example/login" });
    expect(isAllowedMutationOrigin(bad, APP_URL)).toBe(false);
  });

  it("blocks malformed Origin values", () => {
    expect(
      isAllowedMutationOrigin(mutation({ origin: "not-a-url" }), APP_URL),
    ).toBe(false);
    expect(isAllowedMutationOrigin(mutation({ origin: "null" }), APP_URL)).toBe(
      false,
    );
  });

  it("allows origin-less unauthenticated mutations (non-browser callers)", () => {
    expect(isAllowedMutationOrigin(mutation(), APP_URL)).toBe(true);
  });

  it("fails closed when a session cookie is present without a proven origin", () => {
    const withCookie = mutation({
      cookie: `${sessionCookieName()}=sess-abc`,
    });
    expect(isAllowedMutationOrigin(withCookie, APP_URL)).toBe(false);
    const withCookieAndOrigin = mutation({
      cookie: `${sessionCookieName()}=sess-abc`,
      origin: "https://app.example",
    });
    expect(isAllowedMutationOrigin(withCookieAndOrigin, APP_URL)).toBe(true);
  });
});
