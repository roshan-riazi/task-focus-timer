import { afterEach, describe, expect, it } from "vitest";
import { sessionCookieConfig, sessionCookieName } from "./cookies";

const APP_URL_KEY = "APP_URL";
let saved: string | undefined;

function setAppUrl(value: string | undefined) {
  if (value === undefined) delete process.env[APP_URL_KEY];
  else process.env[APP_URL_KEY] = value;
}

describe("sessionCookieConfig (single source of truth for Auth.js cookie compat)", () => {
  saved = process.env[APP_URL_KEY];
  afterEach(() => setAppUrl(saved));

  it("uses the plain cookie name over http (dev, E2E, local)", () => {
    setAppUrl("http://localhost:3000");
    expect(sessionCookieName()).toBe("authjs.session-token");
    expect(sessionCookieConfig().secure).toBe(false);
  });

  it("uses the __Secure- prefix with the secure flag over https (prod)", () => {
    setAppUrl("https://app.example");
    expect(sessionCookieName()).toBe("__Secure-authjs.session-token");
    expect(sessionCookieConfig().secure).toBe(true);
  });

  it("defaults to http semantics when APP_URL is unset", () => {
    setAppUrl(undefined);
    expect(sessionCookieName()).toBe("authjs.session-token");
  });

  it("fails closed to http semantics on a malformed APP_URL", () => {
    setAppUrl("not-a-url");
    expect(sessionCookieConfig().secure).toBe(false);
  });
});
